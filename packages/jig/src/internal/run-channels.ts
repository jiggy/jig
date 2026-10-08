import { USER_UPDATES_CONTRACT } from '@jigging/user-updates'
import type { RootRunStatus } from '../administration/root.js'
import {
  CHANNEL_CONTRACT_BYTES,
  type ChannelDeclaration as PackageChannelDeclaration,
  parseChannelContract,
  requireChannelReference,
} from '../channel-contract.js'
import type { PrivateCallEvent } from '../cli-run-model.js'
import type { PrivateUserUpdateSource } from '../cli-user-updates.js'
import type { JsonValue } from '../json.js'
import type { CapturedPackage } from '../package/capture.js'
import { type InspectedPackage, inspectCapturedPackage } from '../package/inspect.js'
import {
  ChannelBroker,
  type ChannelContractReference,
  type ChannelDeclaration,
  type ChannelGrant,
  ChannelOperationError,
  type ChannelParticipant,
  type ResolvedChannelContract,
} from '../run/channels.js'

/** Command-local presentation. Its callbacks confer no execution authority. */
export interface PrivateRunChannelOutput {
  readonly receive: readonly string[]
  /** Trusted root admission crossed the execution boundary; not a Flow claim. */
  dispatched?(): void
  call?(event: PrivateCallEvent): void
  readonly updates?: {
    open(port: string): PrivateUserUpdateSource
    ambiguous(ports: readonly string[]): void
  }
  record(value: JsonValue): Promise<void>
  diagnostic(bytes: Uint8Array, operations?: readonly string[]): void
  /** Command-local observation of an authoritative settled root, including during close. */
  terminal?(status: Extract<RootRunStatus, { state: 'terminal' }>): void
}

export type PrivateChannelContractCache = Map<string, Promise<ResolvedChannelContract>>

export class PrivateRunChannels {
  readonly broker: ChannelBroker
  readonly root: ChannelParticipant
  readonly grants: Readonly<Record<string, ChannelGrant>>
  readonly contracts: PrivateChannelContractCache
  private readonly readers: Promise<void>[] = []

  private constructor(
    root: ChannelParticipant,
    grants: Readonly<Record<string, ChannelGrant>>,
    broker: ChannelBroker,
    contracts: PrivateChannelContractCache,
  ) {
    this.root = root
    this.grants = grants
    this.broker = broker
    this.contracts = contracts
  }

  static async open(
    captured: CapturedPackage,
    inspected: InspectedPackage,
    output?: PrivateRunChannelOutput,
  ): Promise<PrivateRunChannels> {
    const broker = new ChannelBroker()
    const contracts: PrivateChannelContractCache = new Map()
    const resolveContract = channelContractResolver(captured, contracts, inspected)
    const root = broker.participant('root', { resolveContract })
    const declarations = await resolveChannelDeclarations(
      inspected.invocation?.channels ?? {},
      resolveContract,
    )
    const cli = broker.participant('command', { resolveContract })
    const references: Record<string, string> = Object.create(null)
    const readers: { name: string; endpoint: string; updates?: PrivateUserUpdateSource }[] = []
    let context: PrivateRunChannels | undefined
    try {
      const selected = output?.receive ?? []
      if (new Set(selected).size !== selected.length || selected.length > 16)
        throw new ChannelOperationError('INVALID_INPUT', 'select each root output once, at most 16')
      for (const name of selected) {
        const declaration = inspected.invocation?.channels?.[name]
        if (declaration?.direction !== 'send')
          throw new ChannelOperationError(
            'UNAVAILABLE',
            `root channel ${name} is not a supported output`,
          )
        const pair = await cli.create({
          delivery: declaration.delivery ?? 'direct',
          ...(declaration.schema === undefined ? {} : { schema: declaration.schema }),
          ...(declaration.contract === undefined ? {} : { contract: declaration.contract }),
        })
        references[name] = pair.send.endpoint
        const receiver = 'receive' in pair ? pair.receive : cli.subscribe(pair.source)
        readers.push({ name, endpoint: receiver.endpoint })
      }
      if (selected.length === 0 && output?.updates !== undefined) {
        const expected = USER_UPDATES_CONTRACT
        const matches = Object.entries(declarations).filter(
          ([, port]) =>
            port.direction === 'send' &&
            !port.required &&
            port.contract?.identity.id === expected.id &&
            port.contract.identity.version === expected.version &&
            port.contract.identity.digest === expected.digest,
        )
        if (matches.length > 1) output.updates.ambiguous(matches.map(([name]) => name))
        else if (matches.length === 1) {
          const pair = broker.createPresentation(cli, declarations)
          references[pair.name] = pair.send.endpoint
          readers.push({
            name: pair.name,
            endpoint: pair.receive.endpoint,
            updates: output.updates.open(pair.name),
          })
        }
      }
      const grants = cli.transfer(root, references, declarations)
      context = new PrivateRunChannels(root, grants, broker, contracts)
      for (const reader of readers) {
        if (reader.updates === undefined)
          await output!.record({ type: 'begin', channel: reader.name, startSequence: 1 })
        const task = context.drain(cli, reader, output!)
        // Preserve its failure for settlement without an unhandled rejection
        // when another selected stream fails during startup.
        void task.catch(() => undefined)
        context.readers.push(task)
      }
      return context
    } catch (error) {
      broker.abort('CANCELLED')
      for (const reader of readers) reader.updates?.retire()
      await Promise.allSettled(context?.readers ?? [])
      throw error
    }
  }

  async settle(): Promise<void> {
    try {
      this.root.finalize(false)
      await Promise.all(this.readers)
    } finally {
      this.broker.abort('DISCONNECTED')
      await Promise.allSettled(this.readers)
    }
  }

  private async drain(
    cli: ChannelParticipant,
    reader: { name: string; endpoint: string; updates?: PrivateUserUpdateSource },
    output: PrivateRunChannelOutput,
  ): Promise<void> {
    try {
      for (;;) {
        let result: {
          item?: { sequence: number; value: JsonValue }
          end?: { lastSequence: number }
        }
        try {
          result = (await cli.next(reader.endpoint)) as typeof result
        } catch (error) {
          if (reader.updates !== undefined) {
            reader.updates.retire(
              error instanceof ChannelOperationError && error.code === 'INVALID_INPUT'
                ? 'Updates unavailable: contract violation.'
                : `Live progress stopped before all updates were delivered. Check the final result for the work's outcome. (${error instanceof ChannelOperationError ? error.code : 'DISCONNECTED'})`,
            )
            return
          }
          await output.record({
            type: 'end',
            channel: reader.name,
            status: 'failed',
            code: error instanceof ChannelOperationError ? error.code : 'DISCONNECTED',
          })
          return
        }
        if (result.end !== undefined) {
          if (reader.updates !== undefined) {
            reader.updates.retire()
            return
          }
          await output.record({
            type: 'end',
            channel: reader.name,
            status: 'closed',
            lastSequence: result.end.lastSequence,
          })
          return
        }
        if (reader.updates !== undefined) {
          if (
            !reader.updates.accept(
              result.item!.value,
              this.broker.publisherOf(result as unknown as JsonValue),
            )
          )
            return
        } else await output.record({ type: 'data', channel: reader.name, ...result.item! })
      }
    } finally {
      reader.updates?.retire()
      await cli.release(reader.endpoint)
    }
  }
}

export function channelContractResolver(
  captured: CapturedPackage,
  cache: PrivateChannelContractCache = new Map(),
  inspected?: InspectedPackage,
): (path: ChannelContractReference) => Promise<ResolvedChannelContract> {
  let inspection: Promise<InspectedPackage> | undefined
  return async (reference) => {
    if (typeof reference !== 'string') {
      const selector = reference
      inspection ??=
        inspected === undefined ? inspectCapturedPackage(captured) : Promise.resolve(inspected)
      const packageInfo = inspected ?? (await inspection)
      const used = packageInfo.usedContracts.find((entry) => entry.slot === selector.slot)
      const port = used?.contract.invocation?.channels?.[selector.channel]
      if (!used || !port?.contract)
        throw new ChannelOperationError(
          'INVALID_INPUT',
          'slot channel has no declared named agreement',
        )
      const slash = used.path.lastIndexOf('/')
      reference = `./${slash < 0 ? '' : used.path.slice(0, slash + 1)}${port.contract.slice(2)}`
    }
    requireChannelReference(reference, 'channel contract')
    const key = `${captured.digest}:${reference}`
    let pending = cache.get(key)
    if (pending !== undefined) return pending
    // Cache is finite independently of the number of failed local attempts.
    if (cache.size >= 16)
      throw new ChannelOperationError('RESOURCE_EXHAUSTED', 'channel contract cache limit reached')
    pending = (async () => {
      const contract = parseChannelContract(
        await captured.read(reference.slice(2), CHANNEL_CONTRACT_BYTES),
        reference,
      )
      return {
        identity: {
          id: contract.descriptor.id,
          version: contract.descriptor.version,
          digest: contract.digest,
        },
        schema:
          contract.descriptor.$defs === undefined
            ? contract.descriptor.item
            : {
                $defs: contract.descriptor.$defs,
                ...(typeof contract.descriptor.item === 'boolean'
                  ? { allOf: [contract.descriptor.item] }
                  : contract.descriptor.item),
              },
        validate(value: JsonValue) {
          contract.itemSchema.validate(value, 'INVALID_INPUT')
        },
      }
    })()
    cache.set(key, pending)
    return pending
  }
}

export async function resolveChannelDeclarations(
  declarations: Readonly<Record<string, PackageChannelDeclaration>>,
  resolve: (path: string) => Promise<ResolvedChannelContract>,
): Promise<Readonly<Record<string, ChannelDeclaration>>> {
  const result: Record<string, ChannelDeclaration> = Object.create(null)
  for (const [name, { contract, ...declaration }] of Object.entries(declarations))
    result[name] = {
      ...declaration,
      ...(contract === undefined ? {} : { contract: await resolve(contract) }),
    }
  return result
}

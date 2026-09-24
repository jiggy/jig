import { posix } from 'node:path'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import type { PrivateActivationRequest } from '../project/package-resolution.js'
import { closePrivateExecutionOutput, type PrivateExecutionOutput } from './execution-output.js'
import type { PrivateDeliveryConnection } from './file-delivery.js'
import {
  PRIVATE_FILE_LIMITS,
  type PrivateCapturedAttachment,
  privateAttachmentName,
  privateFilePath,
  sha256,
} from './file-input.js'
import { privateDomainDigest } from './identity.js'
import { PRIVATE_OUTPUT_PATH, type PrivateLinuxLaunchPlan } from './linux-rootless-backend.js'
import {
  parseRunCheckpointInput,
  RUN_CHECKPOINT_CONTRACT_DIGEST,
} from './private-run-checkpoint.js'

export interface PrivateRunFileIdentity {
  readonly attachments: readonly {
    readonly name: string
    readonly files: readonly {
      readonly path: string
      readonly bytes: number
      readonly digest: string
    }[]
  }[]
  readonly output: string | null
}
export const PRIVATE_EMPTY_FILE_IDENTITY: PrivateRunFileIdentity = Object.freeze({
  attachments: Object.freeze([]),
  output: null,
})

export function normalizePrivateRunFileIdentity(value: unknown): PrivateRunFileIdentity {
  const root = object(value, ['attachments', 'output'])
  if (
    !Array.isArray(root.attachments) ||
    root.attachments.length > 8 ||
    (root.output !== null &&
      (typeof root.output !== 'string' ||
        !root.output.startsWith('/') ||
        posix.normalize(root.output) !== root.output ||
        Buffer.from(root.output).toString('utf8') !== root.output ||
        root.output.includes('\0') ||
        root.output.length > 4096))
  )
    throw new TypeError('invalid root file identity')
  let bytes = 0,
    count = 0
  const attachments = root.attachments
    .map((value) => {
      const item = object(value, ['name', 'files'])
      const name = privateAttachmentName(item.name as string)
      if (!Array.isArray(item.files) || item.files.length > PRIVATE_FILE_LIMITS.files)
        throw new TypeError('invalid captured file list')
      const files = item.files
        .map((value) => {
          const file = object(value, ['path', 'bytes', 'digest'])
          const path = privateFilePath(file.path as string)
          if (
            typeof file.bytes !== 'number' ||
            !Number.isSafeInteger(file.bytes) ||
            file.bytes < 0 ||
            typeof file.digest !== 'string' ||
            !/^sha256:[0-9a-f]{64}$/.test(file.digest)
          )
            throw new TypeError('invalid captured file identity')
          bytes += file.bytes
          count++
          return Object.freeze({ path, bytes: file.bytes, digest: file.digest })
        })
        .sort((a, b) => (a.path < b.path ? -1 : 1))
      if (new Set(files.map((file) => file.path)).size !== files.length)
        throw new TypeError('duplicate captured path')
      return Object.freeze({ name, files: Object.freeze(files) })
    })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  if (
    new Set(attachments.map((item) => item.name)).size !== attachments.length ||
    bytes > PRIVATE_FILE_LIMITS.bytes ||
    count > PRIVATE_FILE_LIMITS.files
  )
    throw new TypeError('root input file limits exceeded')
  return Object.freeze({
    attachments: Object.freeze(attachments),
    output: root.output as string | null,
  })
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
  )
    throw new TypeError('invalid root file record')
  return value as Record<string, unknown>
}

export function requirePrivateRootFileMapping(
  request: PrivateActivationRequest,
  identity: PrivateRunFileIdentity,
): void {
  const expected = Object.entries(request.attachments)
    .filter(
      ([name, access]) => access === 'read' && !Object.hasOwn(request.boundAttachments ?? {}, name),
    )
    .map(([name]) => name)
    .sort()
  const supplied = identity.attachments.map((item) => item.name)
  if (expected.join('\0') !== supplied.join('\0'))
    throw new TypeError('provide exactly the read attachments declared by the admitted root target')
  normalizePrivateRunFileIdentity({
    attachments: [
      ...identity.attachments,
      ...Object.entries(request.boundAttachments ?? {}).map(([name, item]) => ({
        name,
        files: item.files,
      })),
    ],
    output: identity.output,
  })
  if (Object.values(request.attachments).includes('read-write') && identity.output === null)
    throw new TypeError('the admitted root target requires --out for its writable attachment')
}

/** Invocation-local descriptors. Identity alone can never recreate this authority. */
export class PrivateRootRunFiles {
  readonly identity: PrivateRunFileIdentity
  #runId: string | undefined
  #output: PrivateExecutionOutput | undefined
  #checkpointBound = false
  #method:
    | {
        readonly package: PrivateActivationRequest['package']
        readonly configurationDigest: string
      }
    | undefined

  constructor(
    readonly captured: readonly PrivateCapturedAttachment[],
    output: string | null,
    readonly delivery?: PrivateDeliveryConnection,
  ) {
    this.identity = normalizePrivateRunFileIdentity({
      attachments: captured.map((item) => ({
        name: item.name,
        files: item.files.map(({ path, input: { bytes, digest } }) => ({ path, bytes, digest })),
      })),
      output,
    })
  }
  projection(
    runId: string,
    request: PrivateActivationRequest,
    identity: PrivateRunFileIdentity,
    bound: readonly Omit<PrivateCapturedAttachment, 'rootFd'>[] = [],
  ): {
    readonly plan: Pick<PrivateLinuxLaunchPlan, 'capturedInputs' | 'inputDirectories' | 'output'>
    readonly attachments: Readonly<
      Record<string, { readonly path: string; readonly access: 'read' | 'read-write' }>
    >
  } {
    if (
      (this.#runId !== undefined && this.#runId !== runId) ||
      !Buffer.from(canonicalJson(identity as unknown as JsonValue)).equals(
        canonicalJson(this.identity as unknown as JsonValue),
      )
    )
      throw new TypeError('file authority does not belong to this Run')
    this.#runId = runId
    requirePrivateRootFileMapping(request, identity)
    const boundIdentity = normalizePrivateRunFileIdentity({
      attachments: bound.map((item) => ({
        name: item.name,
        files: item.files.map(({ path, input: { bytes, digest } }) => ({ path, bytes, digest })),
      })),
      output: null,
    })
    const expectedBound = normalizePrivateRunFileIdentity({
      attachments: Object.entries(request.boundAttachments ?? {}).map(([name, item]) => ({
        name,
        files: item.files,
      })),
      output: null,
    })
    if (
      !Buffer.from(canonicalJson(boundIdentity as unknown as JsonValue)).equals(
        canonicalJson(expectedBound as unknown as JsonValue),
      )
    )
      throw new TypeError('retained attachment projection does not match admitted contents')
    this.identify(request)
    const attachments = Object.fromEntries(
      Object.entries(request.attachments).map(([name, access]) => [
        name,
        { access, path: access === 'read' ? `/jig-input/${name}` : PRIVATE_OUTPUT_PATH },
      ]),
    )
    return {
      plan: {
        capturedInputs: [...this.captured, ...bound].flatMap((item) =>
          item.files.map((file) => ({
            input: file.input,
            destination: `/jig-input/${item.name}/${file.path}`,
          })),
        ),
        inputDirectories: [...this.captured, ...bound].map((item) => `/jig-input/${item.name}`),
        output: Object.values(request.attachments).includes('read-write'),
      },
      attachments,
    }
  }
  identify(request: PrivateActivationRequest): void {
    this.#method = Object.freeze({
      package: request.package,
      configurationDigest: privateDomainDigest(
        'JIG-Run-Configuration/1',
        decodeJson1(
          canonicalJson({
            settings: request.settings,
            slots: request.slots,
            attachments: request.attachments,
            ...(request.boundAttachments === undefined
              ? {}
              : { boundAttachments: request.boundAttachments }),
          } as unknown as JsonValue),
        ),
      ),
    })
  }
  retainOutput(handle: PrivateExecutionOutput | undefined): void {
    if (this.#output !== undefined) throw new Error('output already has an owner')
    this.#output = handle
  }
  get output(): PrivateExecutionOutput | undefined {
    return this.#output
  }
  get method() {
    return this.#method
  }
  async bindCheckpoint(
    runId: string,
    request: PrivateActivationRequest,
    input: JsonValue,
    project: string,
    epoch: number,
  ): Promise<void> {
    if (
      !Object.values(request.slots).some(
        (route) => route.kind === 'native' && route.native === 'run-checkpoint',
      )
    )
      return
    if (this.#checkpointBound) {
      if (this.#runId !== runId) throw new Error('checkpoint belongs to another Run')
      return
    }
    if (this.identity.output === null || this.delivery?.bindCheckpoint === undefined)
      throw new Error('Run Checkpoint requires the installed output owner')
    this.identify(request)
    await this.delivery.bindCheckpoint(
      {
        runId,
        method: this.#method as unknown as JsonValue,
        input: {
          digest: sha256(canonicalJson(input)),
          attachments: this.identity.attachments,
        } as unknown as JsonValue,
      },
      project,
      epoch,
    )
    this.#runId = runId
    this.#checkpointBound = true
  }
  async saveCheckpoint(value: unknown) {
    if (!this.#checkpointBound || this.delivery?.saveCheckpoint === undefined)
      throw new Error('checkpoint owner unavailable')
    return await this.delivery.saveCheckpoint(parseRunCheckpointInput(value))
  }
  async close(): Promise<void> {
    await closePrivateExecutionOutput(this.#output)
    this.#output = undefined
  }
}

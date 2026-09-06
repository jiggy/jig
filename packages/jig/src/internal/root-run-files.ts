import type { FileHandle } from 'node:fs/promises'
import { posix } from 'node:path'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import type { PrivateActivationRequest } from '../project/package-resolution.js'
import { privateDomainDigest } from './identity.js'
import {
  PRIVATE_FILE_LIMITS,
  privateAttachmentName,
  privateFilePath,
  type PrivateCapturedAttachment,
} from './linux-file-input.js'
import { PRIVATE_OUTPUT_PATH, type PrivateLinuxLaunchPlan } from './linux-rootless-backend.js'

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
    .filter(([, access]) => access === 'read')
    .map(([name]) => name)
    .sort()
  const supplied = identity.attachments.map((item) => item.name)
  if (expected.join('\0') !== supplied.join('\0'))
    throw new TypeError('provide exactly the read attachments declared by the admitted root target')
  if (Object.values(request.attachments).includes('read-write') && identity.output === null)
    throw new TypeError('the admitted root target requires --out for its writable attachment')
}

/** Invocation-local descriptors. Identity alone can never recreate this authority. */
export class PrivateRootRunFiles {
  readonly identity: PrivateRunFileIdentity
  #runId: string | undefined
  #output: FileHandle | undefined
  #method:
    | {
        readonly package: PrivateActivationRequest['package']
        readonly configurationDigest: string
      }
    | undefined

  constructor(
    readonly captured: readonly PrivateCapturedAttachment[],
    output: string | null,
  ) {
    this.identity = normalizePrivateRunFileIdentity({
      attachments: captured.map((item) => ({
        name: item.name,
        files: item.files.map(({ path, bytes, digest }) => ({ path, bytes, digest })),
      })),
      output,
    })
  }
  projection(
    runId: string,
    request: PrivateActivationRequest,
    identity: PrivateRunFileIdentity,
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
    this.identify(request)
    const attachments = Object.fromEntries(
      Object.entries(request.attachments).map(([name, access]) => [
        name,
        { access, path: access === 'read' ? `/jig-input/${name}` : PRIVATE_OUTPUT_PATH },
      ]),
    )
    return {
      plan: {
        capturedInputs: this.captured.flatMap((item) =>
          item.files.map((file) => ({
            fd: file.fd,
            bytes: file.bytes,
            digest: file.digest,
            destination: `/jig-input/${item.name}/${file.path}`,
          })),
        ),
        inputDirectories: this.captured.map((item) => `/jig-input/${item.name}`),
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
            capabilities: request.capabilities,
            flowSlots: request.flowSlots,
            attachments: request.attachments,
          } as unknown as JsonValue),
        ),
      ),
    })
  }
  retainOutput(handle: FileHandle | undefined): void {
    if (this.#output !== undefined) throw new Error('output already has an owner')
    this.#output = handle
  }
  get outputDirectory(): FileHandle | undefined {
    return this.#output
  }
  get method() {
    return this.#method
  }
  async close(): Promise<void> {
    await this.#output?.close()
    this.#output = undefined
  }
}

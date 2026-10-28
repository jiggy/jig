import { CheckError } from '../diagnostics.js'
import { canonicalJson, decodeJson1, type JsonValue } from '../json.js'
import type { PrivateActivationRequest } from '../project/package-resolution.js'
import { capturePrivateOutputComposition, type PrivateCapturedOutput } from './captured-output.js'
import { PRIVATE_OUTPUT_PATH, type PrivateExecutionIntent } from './execution-intent.js'
import {
  closePrivateExecutionOutput,
  type PrivateExecutionOutput,
  privateSnapshotExecutionOutput,
} from './execution-output.js'
import type { PrivateDeliveryConnection } from './file-delivery.js'
import {
  PRIVATE_FILE_LIMITS,
  type PrivateCapturedAttachment,
  privateAttachmentName,
  privateFilePath,
  sha256,
} from './file-input.js'
import {
  capturePrivateFlowArtifact,
  createPrivateRootFlowFileContext,
  PrivateArtifactPermissionError,
  type PrivateFlowFileContext,
  privateFlowFileExecutionProjection,
  retainPrivateFlowArtifactResults,
  selectedPrivateFlowArtifacts,
} from './flow-file-context.js'
import { privateDomainDigest } from './identity.js'
import type {
  RunCheckpointIdentity,
  RunCheckpointInput,
  RunCheckpointReceipt,
} from './private-run-checkpoint.js'
import { PrivateCheckpointRejected, parseRunCheckpointInput } from './private-run-checkpoint.js'

export type PrivateCheckpointCommit = (input: {
  readonly identity: RunCheckpointIdentity
  readonly value: RunCheckpointInput
  readonly artifacts: Readonly<Record<string, PrivateCapturedOutput>>
}) => Promise<RunCheckpointReceipt>

export interface PrivateRunFileIdentity {
  readonly attachments: readonly {
    readonly name: string
    readonly files: readonly {
      readonly path: string
      readonly bytes: number
      readonly digest: string
    }[]
  }[]
  /** Native writable output intent, independent of any later export destination. */
  readonly output: boolean
}
export const PRIVATE_EMPTY_FILE_IDENTITY: PrivateRunFileIdentity = Object.freeze({
  attachments: Object.freeze([]),
  output: false,
})

export interface PrivateRootFileMappingFailure {
  readonly missingReads: readonly string[]
  readonly unknownNames: readonly string[]
  readonly boundOverrides: readonly string[]
  readonly missingWritableDestination: readonly string[]
}

/** Closed admitted-interface facts, without source paths or arbitrary exception text. */
export class PrivateRootFileMappingError extends CheckError {
  readonly fileMapping: PrivateRootFileMappingFailure

  constructor(failure: PrivateRootFileMappingFailure) {
    super(
      'invalid',
      'RUN_ATTACHMENTS_INVALID',
      'root file mappings do not match the admitted target',
    )
    const names = (values: readonly string[]) => {
      if (values.length > 8) throw new TypeError('file mapping diagnostic exceeds its name bound')
      return Object.freeze([...new Set(values.map(privateAttachmentName))].sort())
    }
    this.fileMapping = Object.freeze({
      missingReads: names(failure.missingReads),
      unknownNames: names(failure.unknownNames),
      boundOverrides: names(failure.boundOverrides),
      missingWritableDestination: names(failure.missingWritableDestination),
    })
  }
}

export class PrivateRootFileInputLimitError extends CheckError {
  constructor() {
    super(
      'invalid',
      'RUN_ATTACHMENTS_INVALID',
      'combined retained and per-run inputs exceed the 64-file/64-MiB limit',
    )
  }
}

export function normalizePrivateRunFileIdentity(value: unknown): PrivateRunFileIdentity {
  const root = object(value, ['attachments', 'output'])
  if (
    !Array.isArray(root.attachments) ||
    root.attachments.length > 8 ||
    typeof root.output !== 'boolean'
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
  if (new Set(attachments.map((item) => item.name)).size !== attachments.length)
    throw new TypeError('duplicate root attachment name')
  if (bytes > PRIVATE_FILE_LIMITS.bytes || count > PRIVATE_FILE_LIMITS.files)
    throw new PrivateRootFileInputLimitError()
  return Object.freeze({
    attachments: Object.freeze(attachments),
    output: root.output,
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
  const expectedNames = new Set(expected),
    suppliedNames = new Set(supplied)
  const failure = {
    missingReads: expected.filter((name) => !suppliedNames.has(name)),
    unknownNames: supplied.filter(
      (name) => !expectedNames.has(name) && !Object.hasOwn(request.boundAttachments ?? {}, name),
    ),
    boundOverrides: supplied.filter((name) => Object.hasOwn(request.boundAttachments ?? {}, name)),
    missingWritableDestination: !identity.output
      ? Object.entries(request.attachments)
          .filter(([, access]) => access === 'read-write')
          .map(([name]) => name)
      : [],
  }
  if (Object.values(failure).some((names) => names.length > 0))
    throw new PrivateRootFileMappingError(failure)
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
}

/** Invocation-local descriptors. Identity alone can never recreate this authority. */
export class PrivateRootRunFiles {
  readonly identity: PrivateRunFileIdentity
  #runId: string | undefined
  #output: PrivateExecutionOutput | undefined
  #close: Promise<void> | undefined
  #checkpointBound = false
  #checkpointOwner: { identity: RunCheckpointIdentity; commit: PrivateCheckpointCommit } | undefined
  #outputAttachments: readonly string[] = []
  #artifacts: Readonly<Record<string, PrivateCapturedOutput>> = Object.freeze({})
  #artifactsRetained = false
  #nativeArtifactsRetained = false
  #artifactResultNames: readonly string[] = []
  #deliveryOutput: PrivateExecutionOutput | undefined
  #method:
    | {
        readonly package: PrivateActivationRequest['package']
        readonly configurationDigest: string
      }
    | undefined

  constructor(
    readonly captured: readonly Pick<PrivateCapturedAttachment, 'name' | 'files'>[],
    output: boolean,
    readonly delivery?: PrivateDeliveryConnection,
    readonly displayBundleAttachment?: string,
  ) {
    if (displayBundleAttachment !== undefined) privateAttachmentName(displayBundleAttachment)
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
    readonly context: PrivateFlowFileContext
    readonly plan: Pick<
      PrivateExecutionIntent,
      'capturedInputs' | 'inputDirectories' | 'inputEmptyDirectories' | 'output'
    >
    readonly attachments: Readonly<
      Record<
        string,
        {
          readonly path: string
          readonly access: 'read' | 'read-write'
          readonly artifact?: string
        }
      >
    >
  } {
    if (this.#close) throw new Error('Run file owner retired')
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
      output: false,
    })
    const expectedBound = normalizePrivateRunFileIdentity({
      attachments: Object.entries(request.boundAttachments ?? {}).map(([name, item]) => ({
        name,
        files: item.files,
      })),
      output: false,
    })
    if (
      !Buffer.from(canonicalJson(boundIdentity as unknown as JsonValue)).equals(
        canonicalJson(expectedBound as unknown as JsonValue),
      )
    )
      throw new TypeError('retained attachment projection does not match admitted contents')
    this.identify(request)
    const context = createPrivateRootFlowFileContext({
      declarations: request.attachments,
      captured: [...this.captured, ...bound],
    })
    const projection = privateFlowFileExecutionProjection(context)
    const attachments = Object.fromEntries(
      Object.entries(projection.attachments).map(([name, attachment]) => [
        name,
        {
          ...attachment,
          path: attachment.access === 'read' ? `/jig-input/${name}` : PRIVATE_OUTPUT_PATH,
        },
      ]),
    )
    return {
      context,
      plan: projection.plan,
      attachments,
    }
  }
  identify(request: PrivateActivationRequest): void {
    if (
      this.displayBundleAttachment !== undefined &&
      request.attachments[this.displayBundleAttachment] !== 'read-write' &&
      !request.artifactResults?.includes(this.displayBundleAttachment)
    )
      throw new CheckError(
        'invalid',
        'DISPLAY_BUNDLE_OUTPUT_INVALID',
        'The selected display bundle must name a declared writable attachment or artifact result.',
      )
    this.#outputAttachments = Object.entries(request.attachments)
      .filter(([, access]) => access === 'read-write')
      .map(([name]) => name)
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
    if (this.#close || this.#output !== undefined) throw new Error('output owner unavailable')
    this.#output = handle
  }
  get output(): PrivateExecutionOutput | undefined {
    return this.#output
  }
  get method() {
    return this.#method
  }
  get outputAttachments(): readonly string[] {
    return this.#outputAttachments
  }
  get artifactResultNames(): readonly string[] {
    return this.#artifactResultNames
  }
  /** Ordinary packet composition uses accepted final names, never a mutable broker. */
  deliveryOutput(signal?: AbortSignal): PrivateExecutionOutput | undefined {
    if (this.#close) throw new Error('Run file owner retired')
    if (this.#artifactResultNames.length === 0)
      return this.#outputAttachments.length === 0 ? undefined : this.#output
    if (this.#deliveryOutput !== undefined) return this.#deliveryOutput
    const native = this.#outputAttachments[0]
    const nativeSnapshot = native === undefined ? undefined : this.#artifacts[native]
    if (native !== undefined && nativeSnapshot === undefined)
      throw new Error('root native output snapshot is unavailable')
    const composed = capturePrivateOutputComposition(
      [
        ...(nativeSnapshot === undefined ? [] : [{ snapshot: nativeSnapshot }]),
        ...this.#artifactResultNames.map((name) => ({
          snapshot: this.#artifacts[name]!,
          prefix: name,
        })),
      ],
      signal,
    )
    this.#deliveryOutput = privateSnapshotExecutionOutput(Promise.resolve(composed))
    return this.#deliveryOutput
  }
  /** Original sealed snapshots; ticket retention must consume them before close. */
  get artifacts(): Readonly<Record<string, PrivateCapturedOutput>> {
    return this.#artifacts
  }
  retainArtifacts(
    context: PrivateFlowFileContext,
    names: readonly string[],
    selection: Readonly<Record<string, string>>,
  ): void {
    if (this.#close || this.#artifactsRetained) throw new Error('artifact owner unavailable')
    const snapshots = selectedPrivateFlowArtifacts(context, names, selection)
    retainPrivateFlowArtifactResults(context, snapshots)
    this.#artifacts = Object.freeze({ ...this.#artifacts, ...snapshots })
    this.#artifactResultNames = Object.freeze(Object.keys(snapshots).sort())
    this.#artifactsRetained = true
  }
  /** Capture this root's own fenced writable ports under the same retention owner. */
  async retainNativeArtifacts(
    context: PrivateFlowFileContext,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.#close || this.#nativeArtifactsRetained) throw new Error('artifact owner unavailable')
    if (this.#outputAttachments.length === 0) return
    if (this.#output === undefined) throw new Error('root native output is unavailable')
    const snapshot = await capturePrivateFlowArtifact(context, this.#output, signal)
    const snapshots = Object.fromEntries(this.#outputAttachments.map((name) => [name, snapshot]))
    if (Object.keys(snapshots).some((name) => Object.hasOwn(this.#artifacts, name)))
      throw new TypeError('root artifact names overlap')
    retainPrivateFlowArtifactResults(context, snapshots)
    this.#artifacts = Object.freeze({ ...this.#artifacts, ...snapshots })
    this.#nativeArtifactsRetained = true
  }
  async bindCheckpoint(
    runId: string,
    request: PrivateActivationRequest,
    input: JsonValue,
    project: string,
    epoch: number,
    commit: PrivateCheckpointCommit,
  ): Promise<void> {
    if (this.#close) throw new Error('Run file owner retired')
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
    this.identify(request)
    const identity: RunCheckpointIdentity = {
      runId,
      method: this.#method as unknown as JsonValue,
      input: {
        digest: sha256(canonicalJson(input)),
        attachments: this.identity.attachments,
      } as unknown as JsonValue,
    }
    this.#checkpointOwner = { commit, identity }
    await this.delivery?.bindCheckpoint?.(identity, project, epoch)
    this.#runId = runId
    this.#checkpointBound = true
  }
  async saveCheckpoint(value: unknown, context: PrivateFlowFileContext) {
    if (this.#close) throw new Error('Run file owner retired')
    if (!this.#checkpointBound || this.#checkpointOwner === undefined)
      throw new Error('checkpoint owner unavailable')
    const input = parseRunCheckpointInput(value)
    let artifacts: Readonly<Record<string, PrivateCapturedOutput>>
    try {
      artifacts = selectedPrivateFlowArtifacts(
        context,
        Object.keys(input.artifacts ?? {}),
        input.artifacts ?? {},
      )
    } catch (error) {
      if (error instanceof PrivateArtifactPermissionError || error instanceof TypeError)
        throw new PrivateCheckpointRejected('checkpoint artifact association was rejected')
      throw error
    }
    const retained = await this.#checkpointOwner.commit({
      identity: this.#checkpointOwner.identity,
      value: input,
      artifacts,
    })
    // The protected commit is authoritative even if the publication channel disappears.
    try {
      await this.delivery?.saveCheckpoint?.(input)
    } catch {}
    return { sequence: retained.sequence, digest: retained.digest }
  }
  close(): Promise<void> {
    if (this.#close) return this.#close
    const output = this.#output
    const deliveryOutput = this.#deliveryOutput
    const artifacts = this.#artifacts
    this.#output = undefined
    this.#deliveryOutput = undefined
    this.#artifacts = Object.freeze({})
    this.#close = (async () => {
      const results = await Promise.allSettled([
        closePrivateExecutionOutput(output),
        closePrivateExecutionOutput(deliveryOutput),
        ...[...new Set(Object.values(artifacts))].map((snapshot) =>
          closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(snapshot) }),
        ),
      ])
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (errors.length !== 0) throw new AggregateError(errors, 'Run file retirement failed')
    })()
    return this.#close
  }
}

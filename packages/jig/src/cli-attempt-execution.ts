import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProjectSession } from './administration/project.js'
import type {
  AttemptErrorCode,
  AttemptFrame,
  AttemptRequests,
  AttemptResults,
  CanonicalRequest,
  PrepareRequest,
} from './attempt-contract.js'
import type { PrivateCliOptions } from './cli.js'
import {
  cancelPrivateAttempt,
  inspectPrivateApprovedProject,
  inspectPrivateAttempt,
  preparePrivateAttempt,
  readPrivateAttemptResult,
} from './internal/activation-admission-store.js'
import { type PrivateCapturedAttachment, privateCaptureAttachments } from './internal/file-input.js'
import { capturePrivateInput, type PrivateCapturedInput } from './internal/input-capture.js'
import {
  PrivateAttemptError,
  privateAttemptManifestDigest,
  privateAttemptRequest,
} from './internal/prepared-attempt-store.js'
import { PrivateRootRunFiles } from './internal/root-run-files.js'
import { canonicalJson, type JsonObject, type JsonValue } from './json.js'

type Invocation = Parameters<NonNullable<PrivateCliOptions['executeAttempt']>>[0]

/** Ordinary Run uses the same ticket acceptance contract without recapturing inputs. */
export async function preparePrivateCliRun(input: {
  readonly projectRoot: string
  readonly expectedApproval?: string
  readonly target: string
  readonly input: JsonValue
  readonly captured: readonly PrivateCapturedAttachment[]
  readonly output: boolean
  readonly durationMs: number
}) {
  const inspected = await inspectPrivateApprovedProject(input.projectRoot, input.target)
  if (inspected === null || typeof inspected !== 'object' || Array.isArray(inspected))
    throw new PrivateAttemptError('APPROVAL_CHANGED', 'The target has no current approval.')
  const facts = inspected as JsonObject
  const approval = input.expectedApproval ?? facts.approval
  if (typeof approval !== 'string')
    throw new PrivateAttemptError('APPROVAL_CHANGED', 'The target has no current approval.')
  const declarations = facts.attachments
  const names = new Set<string>(
    Array.isArray(facts.artifactResults) ? (facts.artifactResults as string[]) : [],
  )
  if (declarations !== null && typeof declarations === 'object' && !Array.isArray(declarations))
    for (const [name, access] of Object.entries(declarations))
      if (access === 'read-write') names.add(name)
  const slots = facts.slots
  const checkpoints =
    slots !== null &&
    typeof slots === 'object' &&
    !Array.isArray(slots) &&
    Object.values(slots).some(
      (slot) =>
        slot !== null &&
        typeof slot === 'object' &&
        !Array.isArray(slot) &&
        (slot as JsonObject).kind === 'native' &&
        (slot as JsonObject).native === 'run-checkpoint',
    )
  return await preparePrivateAttempt({
    projectRoot: input.projectRoot,
    captured: input.captured,
    request: {
      expectedApproval: approval,
      target: input.target,
      input: input.input,
      files: capturedManifests(input.captured),
      constraints: {
        durationMs: input.durationMs,
        resultBytes: 1_048_576,
        artifactBytes: input.output || names.size !== 0 || checkpoints ? 268_435_456 : 0,
      },
      outputIntent: { packet: input.output, receive: [...names].sort() },
    },
  })
}

function capturedManifests(captured: readonly Pick<PrivateCapturedAttachment, 'name' | 'files'>[]) {
  return captured.map(({ name, files }) => {
    const manifest = files
      .map(({ path, input }) => ({ path, bytes: input.bytes, digest: input.digest }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return {
      port: name,
      manifestDigest: privateAttemptManifestDigest(manifest),
      bytes: manifest.reduce((sum, file) => sum + file.bytes, 0),
    }
  })
}

/** The installed adapter shares protected host operations with the ordinary CLI. */
export const executePrivateCliAttempt: NonNullable<PrivateCliOptions['executeAttempt']> = async (
  invocation,
) => {
  const { operation, currentDirectory: projectRoot } = invocation
  const write = (frame: AttemptFrame) => invocation.writeRecord(frame as unknown as JsonValue)
  try {
    switch (operation) {
      case 'inspect': {
        const { target } = invocation.request as AttemptRequests['inspect']
        const value = await inspectPrivateApprovedProject(projectRoot, target)
        await write({ protocolVersion: 1, operation, event: 'result', value })
        return 0
      }
      case 'prepare': {
        const value = await prepare(projectRoot, invocation.request as PrepareRequest)
        await write({ protocolVersion: 1, operation, event: 'result', value })
        return 0
      }
      case 'lookup': {
        const { ticket } = invocation.request as AttemptRequests['lookup']
        const { observation } = await inspectPrivateAttempt({ projectRoot, ticket })
        await write({ protocolVersion: 1, operation, event: 'result', value: observation })
        return 0
      }
      case 'cancel': {
        const { ticket } = invocation.request as AttemptRequests['cancel']
        const value = await cancelPrivateAttempt({ projectRoot, ticket })
        await write({ protocolVersion: 1, operation, event: 'result', value })
        return 0
      }
      case 'result': {
        const { ticket } = invocation.request as AttemptRequests['result']
        const value = await readPrivateAttemptResult({ projectRoot, ticket })
        await write({ protocolVersion: 1, operation, event: 'result', value })
        return 0
      }
      case 'submit':
        return await submit(invocation, write)
      case 'export': {
        const value = await exportResult(invocation)
        await write({ protocolVersion: 1, operation, event: 'result', value })
        return 0
      }
    }
  } catch (error) {
    const code = errorCode(error, operation === 'submit')
    await write({
      protocolVersion: 1,
      operation,
      event: 'error',
      code,
      message: privateAttemptFailureMessage(code),
    })
    return invocation.signal?.aborted ? 2 : 1
  }
}

async function prepare(projectRoot: string, request: PrepareRequest) {
  const capture = privateCaptureAttachments(
    request.files.map(({ port, source, selection }) => ({
      name: port,
      directory: resolve(projectRoot, source),
      select: selection,
    })),
  )
  try {
    const files = capturedManifests(capture.attachments)
    return await preparePrivateAttempt({
      projectRoot,
      request: privateAttemptRequest({ ...request, files }),
      captured: capture.attachments,
    })
  } finally {
    capture.close()
  }
}

function requireSameMeaning(retained: CanonicalRequest | undefined, supplied: CanonicalRequest) {
  if (
    retained === undefined ||
    !Buffer.from(canonicalJson(retained as unknown as JsonValue)).equals(
      canonicalJson(privateAttemptRequest(supplied) as unknown as JsonValue),
    )
  )
    throw new PrivateAttemptError(
      retained === undefined ? 'IDENTITY_UNAVAILABLE' : 'REQUEST_CONFLICT',
      'The submission does not identify the original prepared request.',
    )
}

async function submit(invocation: Invocation, write: (frame: AttemptFrame) => Promise<void>) {
  const { currentDirectory: projectRoot, host } = invocation
  const { ticket, request } = invocation.request as AttemptRequests['submit']
  const retained = await inspectPrivateAttempt({ projectRoot, ticket })
  requireSameMeaning(retained.canonicalRequest, request)
  if (retained.observation.receipt !== undefined) {
    await write({
      protocolVersion: 1,
      operation: 'submit',
      event: 'accepted',
      role: 'observer',
      receipt: retained.observation.receipt,
    })
    return 0
  }
  invocation.signal?.throwIfAborted()
  if (invocation.clientClosed.aborted)
    throw new PrivateAttemptError('UNAVAILABLE', 'The submitting connection has closed.')
  const inputs = await inspectPrivateAttempt({ projectRoot, ticket, includeInputs: true })
  requireSameMeaning(inputs.canonicalRequest, request)
  const captures: PrivateCapturedInput[] = []
  let files: PrivateRootRunFiles | undefined
  let session: ProjectSession | undefined
  let closed: Promise<void> | undefined
  let cancellation: Promise<unknown> | undefined
  let cancellationFailure: unknown
  const closeSession = () => (closed ??= session?.close() ?? Promise.resolve())
  const cancelOwner = () => {
    cancellation ??= cancelPrivateAttempt({ projectRoot, ticket })
    void cancellation.catch((error: unknown) => {
      cancellationFailure = error
    })
  }
  let owner = false
  // Preserve nested-finally precedence: later cleanup failures replace earlier
  // failures, but successful cleanup never erases the submission failure.
  let failed = false
  let failure: unknown
  try {
    await executeSubmission()
  } catch (error) {
    failed = true
    failure = error
  }
  invocation.clientClosed.removeEventListener('abort', cancelOwner)
  invocation.signal?.removeEventListener('abort', cancelOwner)
  try {
    await closeSession()
  } catch (error) {
    failed = true
    failure = error
  }
  try {
    await files?.close()
  } catch (error) {
    failed = true
    failure = error
  }
  const failures: unknown[] = []
  for (const capture of captures) {
    try {
      capture.close()
    } catch (error) {
      failures.push(error)
    }
  }
  for (const attachment of inputs.captured) for (const file of attachment.files) file.bytes.fill(0)
  if (failures.length !== 0)
    throw new AggregateError(failures, 'Captured attempt inputs could not be retired.')
  if (failed) throw failure
  return 0

  async function executeSubmission(): Promise<number> {
    const captured = inputs.captured.map(({ name, files }) => ({
      name,
      files: files.map(({ path, bytes }) => {
        const input = capturePrivateInput(bytes)
        captures.push(input)
        return { path, input }
      }),
    }))
    files = new PrivateRootRunFiles(captured, request.outputIntent.packet)
    try {
      session = await host.acquire(projectRoot, {
        expectedAdmissionDigest: request.expectedApproval,
        runTimeoutMs: request.constraints.durationMs,
        files,
      })
    } catch (error) {
      // Another submit may have won between observation and acquisition.
      // Its receipt can be returned without acquiring its execution ownership.
      const raced = await inspectPrivateAttempt({ projectRoot, ticket })
      requireSameMeaning(raced.canonicalRequest, request)
      if (raced.observation.receipt === undefined) throw error
      await write({
        protocolVersion: 1,
        operation: 'submit',
        event: 'accepted',
        role: 'observer',
        receipt: raced.observation.receipt,
      })
      return 0
    }
    invocation.signal?.throwIfAborted()
    if (invocation.clientClosed.aborted)
      throw new PrivateAttemptError('UNAVAILABLE', 'The submitting connection has closed.')
    const accepted = await session.rootAdministration.startPreparedRun({ ticket, request })
    owner = accepted.role === 'owner'
    if (owner) {
      invocation.clientClosed.addEventListener('abort', cancelOwner, { once: true })
      invocation.signal?.addEventListener('abort', cancelOwner, { once: true })
      if (invocation.clientClosed.aborted || invocation.signal?.aborted) cancelOwner()
    }
    await write({
      protocolVersion: 1,
      operation: 'submit',
      event: 'accepted',
      role: accepted.role,
      receipt: accepted.receipt,
    })
    if (!owner) return 0
    for (;;) {
      const status = await session.rootAdministration.runStatus({ runId: accepted.receipt.runId })
      if (status.state === 'terminal') break
      await (host.pause?.(25) ?? delay(25))
    }
    await cancellation
    if (cancellationFailure !== undefined) throw cancellationFailure
    await closeSession()
    const { observation } = await inspectPrivateAttempt({ projectRoot, ticket })
    await write({ protocolVersion: 1, operation: 'submit', event: 'terminal', observation })
    return 0
  }
}

async function exportResult(invocation: Invocation): Promise<AttemptResults['export']> {
  const { currentDirectory: projectRoot, host } = invocation
  const request = invocation.request as AttemptRequests['export']
  if (host.delivery?.exportAttempt === undefined)
    throw new PrivateAttemptError('UNAVAILABLE', 'The independent delivery owner is unavailable.')
  return await host.delivery.exportAttempt({ projectRoot, ...request }, invocation.signal)
}

function errorCode(error: unknown, submission: boolean): AttemptErrorCode {
  if (error instanceof PrivateAttemptError) return error.code
  return submission ? 'EXECUTION_UNCERTAIN' : 'INTERNAL'
}

export function privateAttemptFailureMessage(code: AttemptErrorCode): string {
  switch (code) {
    case 'INVALID_REQUEST':
      return 'Check the request against the approved interface. No replacement work was requested.'
    case 'REQUEST_CONFLICT':
      return 'This ticket belongs to a different frozen request. Reconcile the original attempt.'
    case 'APPROVAL_CHANGED':
      return 'The selected approval is no longer current. Inspect and explicitly select approved work.'
    case 'TICKET_EXPIRED':
    case 'TICKET_INVALID':
    case 'IDENTITY_UNAVAILABLE':
      return 'The original attempt cannot be accepted or fully observed. Missing history is not permission to retry.'
    case 'RESOURCE_EXHAUSTED':
      return 'The bounded host capacity is unavailable. Inspect existing work; do not replay uncertain attempts.'
    case 'CLEANUP_UNRESOLVED':
      return 'Cleanup is not confirmed. Preserve the original ticket and resolve its ownership before new work.'
    default:
      return 'The operation could not be confirmed. Reconcile the original ticket before deciding on new work.'
  }
}

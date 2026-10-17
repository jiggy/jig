import { resolve } from 'node:path'
import type { AttemptRequests, AttemptResults } from '../attempt-contract.js'
import type { JsonValue } from '../json.js'
import {
  acquirePrivateAttemptExport,
  completePrivateAttemptExportDelivery,
  reconcilePrivateAttemptExportDelivery,
  releasePrivateAttemptExport,
} from './activation-admission-store.js'
import {
  capturePrivateOutputComposition,
  capturePrivateRetainedOutput,
  type PrivateCapturedOutput,
} from './captured-output.js'
import { privateBoundInspection } from './delivery-inspection.js'
import { closePrivateExecutionOutput } from './execution-output.js'
import type { PrivateFileDeliveryOwner } from './file-delivery.js'
import { privateDomainDigest } from './identity.js'
import { privateBootRemaining, watchPrivateBootDeadline } from './native-clock.js'
import { PrivateAttemptError } from './prepared-attempt-store.js'
import { privatePresentationNow } from './root-run-timeout-policy.js'

export type PrivateAttemptExportRequest = AttemptRequests['export'] & {
  readonly projectRoot: string
}

const protectedStore = {
  acquire: acquirePrivateAttemptExport,
  reconcile: reconcilePrivateAttemptExportDelivery,
  complete: completePrivateAttemptExportDelivery,
  release: releasePrivateAttemptExport,
}

/** Runs in the independent file-command process. No execution/coordinator recovery,
 * descriptor transfer from the inner CLI, mutable packet read, or Flow dispatch. */
export async function copyPrivateAttemptExport(
  input: PrivateAttemptExportRequest,
  owner: PrivateFileDeliveryOwner,
  outerAbortSignal?: AbortSignal,
  store: typeof protectedStore = protectedStore,
): Promise<AttemptResults['export']> {
  const request = { ...input, destination: resolve(input.projectRoot, input.destination) }
  const source = input.source ?? 'final'
  outerAbortSignal?.throwIfAborted()
  const previous = await store.reconcile(request)
  if (previous) return previous
  const pin = await store.acquire(request)
  const stop = new AbortController()
  const signal =
    outerAbortSignal === undefined ? stop.signal : AbortSignal.any([stop.signal, outerAbortSignal])
  const captures: PrivateCapturedOutput[] = []
  let publicationStarted = false
  let outcomeCommitted = false
  let destinationRetired = false
  let stopWatch: (() => void) | undefined
  try {
    const deadline = { bootId: pin.bootId, monotonicMs: pin.deadlineMonotonicMs }
    stopWatch = watchPrivateBootDeadline(deadline, () => stop.abort())
    const phaseDeadline = privatePresentationNow() + privateBootRemaining(deadline)
    signal.throwIfAborted()
    let capture: PrivateCapturedOutput | undefined
    if (source === 'checkpoint') {
      if (!pin.checkpoint)
        throw new PrivateAttemptError('UNAVAILABLE', 'Checkpoint bytes are unavailable.')
      capture = capturePrivateRetainedOutput(pin.checkpoint)
      captures.push(capture)
    } else {
      const sources = Object.entries(pin.artifacts).map(([name, artifact]) => {
        const snapshot = capturePrivateRetainedOutput(artifact)
        captures.push(snapshot)
        return { snapshot, ...(input.artifactResult === undefined ? { prefix: name } : {}) }
      })
      if (sources.length) {
        capture = capturePrivateOutputComposition(sources, signal)
        captures.push(capture)
      }
    }
    const terminal = pin.observation.terminal
    if (
      !terminal ||
      pin.observation.cleanup !== 'confirmed' ||
      (source === 'final' && terminal.status !== 'succeeded')
    )
      throw new PrivateAttemptError('UNAVAILABLE', 'The original result is not settled.')
    const record: JsonValue = {
      ...(terminal as unknown as Record<string, JsonValue>),
      ...(terminal.status === 'succeeded' ? { output: pin.output ?? null } : {}),
      runId: pin.observation.receipt!.runId,
    }
    signal.throwIfAborted()
    await owner.prepare(request.destination, [])
    publicationStarted = true
    const receipt = await owner.publish(
      record,
      source === 'final' && capture ? { kind: 'snapshot', capture } : undefined,
      source === 'checkpoint' ? pin.checkpoint!.record : undefined,
      source === 'checkpoint',
      signal,
      phaseDeadline,
      source === 'checkpoint' ? capture : undefined,
    )
    if (receipt.status !== 'written') {
      await store.complete({
        projectRoot: request.projectRoot,
        pinId: pin.pinId,
        status: receipt.status,
      })
      outcomeCommitted = true
      throw new PrivateAttemptError(
        'UNAVAILABLE',
        receipt.status === 'unknown'
          ? 'Export publication is unknown. Select a new destination for a new delivery.'
          : 'Export publication failed. Select a new destination for a new delivery.',
      )
    }
    const result = {
      destination: receipt.destination,
      manifestDigest: privateDomainDigest('JIG-Attempt-Export/1', {
        requestDigest: pin.observation.receipt!.requestDigest,
        resultDigest:
          source === 'checkpoint'
            ? pin.checkpoint!.record.digest
            : terminal.status === 'succeeded'
              ? terminal.resultDigest
              : null,
        source,
        artifactResult: input.artifactResult ?? null,
        files: (receipt.files ?? []) as unknown as JsonValue,
      }),
      source,
    }
    await store.complete({
      projectRoot: request.projectRoot,
      pinId: pin.pinId,
      status: 'written',
      result,
    })
    outcomeCommitted = true
    return result
  } finally {
    stopWatch?.()
    stop.abort()
    const cleanup = { deadline: privatePresentationNow() + 20_000 }
    try {
      // The copier itself owns and joins publication before finally. Cleanup
      // uncertainty cannot change a protected known-written outcome.
      await privateBoundInspection(owner.close(), cleanup)
      destinationRetired = true
    } finally {
      try {
        await privateBoundInspection(
          Promise.all(
            captures.map((capture) =>
              closePrivateExecutionOutput({ kind: 'snapshot', ready: Promise.resolve(capture) }),
            ),
          ),
          cleanup,
        )
      } finally {
        try {
          if (!outcomeCommitted)
            await store.complete({
              projectRoot: request.projectRoot,
              pinId: pin.pinId,
              status: publicationStarted ? 'unknown' : 'failed',
            })
        } finally {
          for (const artifact of Object.values(pin.artifacts))
            for (const file of artifact.files) file.bytes.fill(0)
          for (const file of pin.checkpoint?.files ?? []) file.bytes.fill(0)
          if (destinationRetired)
            await store.release({ projectRoot: request.projectRoot, pinId: pin.pinId })
        }
      }
    }
  }
}

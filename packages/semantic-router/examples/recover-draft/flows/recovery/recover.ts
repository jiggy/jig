import { OperationError, type Artifact, type CallResult, type JsonValue, type RunContext, type RunResult } from '@jigging/flow'
import { checkRoutingResult } from '@jigging/semantic-router'

type Request = { label: string; mode: string; attemptLimit?: number; candidates?: 'none' }

import { draftFailureAction } from './failure-policy.mjs'

/** Application policy for this draft format and these local-only workers. */
export async function recoverDraft(run: Pick<RunContext, 'input' | 'call' | 'release' | 'signal'>): Promise<RunResult> {
  const request = run.input as Request
  if (!request || !/^(first|second|other)$/.test(request.label) ||
      !['throw', 'reject', 'no-save', 'bad-context', 'bad-fallback', 'abstain', 'blocked', 'limit'].includes(request.mode) ||
      ![1, 2].includes(request.attemptLimit ?? 2))
    throw new OperationError('INVALID_INPUT', 'Supply a known draft case and one or two permitted attempts.')
  const trace: JsonValue[] = []
  const stop = (outcome: 'blocked' | 'limit', reason: string): RunResult => ({
    outcome, output: { label: request.label, reason, trace },
  })
  const evidence = (stage: string, result: CallResult) => {
    trace.push({ stage, outcome: result.outcome, output: result.output })
  }
  const evaluate = async (operationId: string, artifact: Artifact): Promise<boolean> => {
    const result = await run.call({
      operationId, slot: 'evaluate', input: { label: request.label },
      attachments: { source: { read: artifact } },
    })
    evidence(operationId, result)
    const output = result.output as { accepted?: unknown; reason?: unknown }
    if (result.outcome !== 'done' || !output ||
        Object.keys(output).sort().join(',') !== 'accepted,reason' ||
        typeof output.accepted !== 'boolean' || typeof output.reason !== 'string')
      throw new OperationError('INVALID_RESULT', 'The evaluator returned an invalid verdict.')
    return output.accepted
  }

  run.signal.throwIfAborted()
  let primary: CallResult | undefined
  try {
    primary = await run.call({ operationId: 'draft', slot: 'primary', input: { label: request.label, mode: request.mode } })
    evidence('primary', primary)
  } catch (error) {
    run.signal.throwIfAborted()
    if (!(error instanceof OperationError) || draftFailureAction('primary', error.code) !== 'recover') throw error
    // The configured worker has only local file powers. No external action is replayed.
    trace.push({ stage: 'primary', error: error.code, message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }) })
  }
  if (primary?.artifacts?.report) {
    if (primary.outcome === 'done' && await evaluate('evaluate-primary', primary.artifacts.report))
      return { outcome: 'done', output: { label: request.label, attempts: 1, trace }, artifactResults: { report: primary.artifacts.report } }
    await run.release({ operationId: 'release-primary', artifact: primary.artifacts.report })
  }
  if ((request.attemptLimit ?? 2) === 1) return stop('limit', 'The application permits only one worker attempt.')

  // The awaited original call has settled. Retrieval names that exact direct child operation.
  let retained: CallResult
  try {
    retained = await run.call({ operationId: 'recover-draft', slot: 'checkpoint', input: { operationId: 'draft' } })
  } catch (error) {
    run.signal.throwIfAborted()
    const action = error instanceof OperationError ? draftFailureAction('checkpoint', error.code) : 'propagate'
    if (action === 'unavailable') {
      trace.push({ stage: 'checkpoint', error: 'UNAVAILABLE' })
      return stop('blocked', 'The settled draft checkpoint is unavailable.')
    }
    if (action === 'limit') {
      trace.push({ stage: 'checkpoint', error: 'RESOURCE_EXHAUSTED' })
      return stop('limit', 'The shared checkpoint allowance is exhausted.')
    }
    throw error
  }
  evidence('checkpoint', retained)
  const checkpoint = (retained.output as { checkpoint?: JsonValue }).checkpoint
  if (retained.outcome !== 'done') throw new OperationError('INVALID_RESULT', 'Checkpoint retrieval did not complete.')
  if (checkpoint === null) return stop('blocked', 'The worker settled without a saved checkpoint.')
  const saved = retained.artifacts?.checkpoint
  if (!checkpoint || !saved) throw new OperationError('INVALID_RESULT', 'The saved checkpoint has no readable artifact.')
  try {
    const repaired = await run.call({
      operationId: 'repair-context', slot: 'repair', input: { label: request.label },
      attachments: { source: { read: saved } },
    })
    evidence('repair', repaired)
    if (repaired.outcome !== 'done') return stop('blocked', 'Retained draft data could not be repaired and validated.')
    const adapted = repaired.output as { label?: unknown; paragraphs?: unknown }
    if (!adapted || Object.keys(adapted).sort().join(',') !== 'label,paragraphs' ||
        adapted.label !== request.label || !Array.isArray(adapted.paragraphs) ||
        adapted.paragraphs.length !== 1 || adapted.paragraphs[0] !== `Partial draft for ${request.label}.`)
      throw new OperationError('INVALID_RESULT', 'The repair method returned invalid draft input.')
    const candidates = request.candidates === 'none' ? [] : [{
      id: 'finish', description: 'Complete one supplied partial text draft and preserve its binary material without external actions.',
    }]
    const choice = await run.call({
      operationId: 'select-fallback', slot: 'selector',
      input: { task: `Complete the retained draft for ${request.label}. Preserve its text and binary material. Case: ${request.mode}.`, candidates },
    })
    evidence('selection', choice)
    const decision = checkRoutingResult(choice, candidates)
    if (decision.outcome !== 'done') return stop(decision.outcome, decision.output.reason)
    if (decision.output.candidateId === null) return stop('blocked', decision.output.reason)
    // Exact membership does not authorize a new slot. This application permits only this map.
    if (decision.output.candidateId !== 'finish') throw new OperationError('INVALID_RESULT', 'Unknown draft finisher.')
    run.signal.throwIfAborted()
    const replacement = await run.call({
      operationId: 'finish-draft', slot: 'finish',
      input: { label: request.label, paragraphs: adapted.paragraphs as string[], mode: request.mode },
      attachments: { source: { read: saved }, report: { create: true } },
    })
    evidence('fallback', replacement)
    if (replacement.outcome !== 'done' || !replacement.artifacts?.report)
      return stop('blocked', 'The replacement worker did not produce a report.')
    if (!await evaluate('evaluate-fallback', replacement.artifacts.report)) {
      await run.release({ operationId: 'release-rejected-fallback', artifact: replacement.artifacts.report })
      return stop('blocked', 'The replacement report failed independent acceptance.')
    }
    return {
      outcome: 'done', output: { label: request.label, attempts: 2, trace },
      artifactResults: { report: replacement.artifacts.report },
    }
  } finally {
    await run.release({ operationId: 'release-checkpoint', artifact: saved })
  }
}

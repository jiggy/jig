import { OperationError, type RunContext, type RunResult } from '@jigging/flow'

const phases = ['baseline', 'proposal', 'check', 'finished'] as const
type Phase = (typeof phases)[number]

export function formatProgress(
  value: unknown,
  style: 'compact' | 'descriptive',
): { phase: Phase; text: string } {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join(',') !== 'attempt,phase'
  )
    throw new TypeError('Invalid repair phase record.')
  const record = value as Record<string, unknown>
  if (
    !phases.includes(record.phase as Phase) ||
    !Number.isInteger(record.attempt) ||
    (record.attempt as number) < 0 ||
    (record.attempt as number) > 2 ||
    (record.phase === 'baseline' && record.attempt !== 0) ||
    ((record.phase === 'proposal' || record.phase === 'check') && record.attempt === 0)
  )
    throw new TypeError('Invalid repair phase record.')
  const phase = record.phase as Phase
  const compact = phase === 'proposal' || phase === 'check' ? `${phase} ${record.attempt}` : phase
  const messages = {
    baseline: 'Reproducing the defect with the fixed checks.',
    proposal: `Requesting repair proposal ${record.attempt} of 2.`,
    check: `Checking candidate ${record.attempt} against the unchanged acceptance cases.`,
    finished: 'Repair method finished; the execution result determines its outcome.',
  }
  return { phase, text: style === 'compact' ? compact : messages[phase] }
}

export async function monitor(
  run: Pick<RunContext, 'channels' | 'settings' | 'signal'>,
): Promise<RunResult> {
  const source = run.channels.phases,
    destination = run.channels.display
  if (source?.direction !== 'receive' || destination?.direction !== 'send')
    throw new TypeError('Connect the phases receiver and display sender.')
  const style = run.settings.style ?? 'descriptive'
  const selected = run.settings.phases ?? [...phases]
  if (
    (style !== 'compact' && style !== 'descriptive') ||
    !Array.isArray(selected) ||
    selected.length > phases.length ||
    new Set(selected).size !== selected.length ||
    selected.some((phase) => !phases.includes(phase as Phase)) ||
    Object.keys(run.settings).some((key) => key !== 'style' && key !== 'phases')
  )
    throw new TypeError('Monitor settings accept style and a unique list of phases.')
  let complete = true,
    displayed = 0
  const recover = (error: unknown) => {
    run.signal.throwIfAborted()
    if (
      !(error instanceof TypeError) &&
      !(
        error instanceof OperationError &&
        [
          'LAGGED',
          'DISCONNECTED',
          'RESOURCE_EXHAUSTED',
          'INVALID_INPUT',
          'INVALID_RESULT',
        ].includes(error.code)
      )
    )
      throw error
    complete = false
  }
  try {
    for await (const value of source) {
      run.signal.throwIfAborted()
      const record = formatProgress(value, style)
      if (!selected.includes(record.phase)) continue
      await destination.send(record.text)
      displayed++
    }
  } catch (error) {
    recover(error)
  } finally {
    try {
      await source.close()
    } catch (error) {
      recover(error)
    }
  }
  run.signal.throwIfAborted()
  return { outcome: complete ? 'done' : 'blocked', output: { complete, displayed } }
}

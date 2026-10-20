import type { JsonValue, RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import {
  type AcceptedAssignment,
  type RosterScenario,
  type RosterState,
  rosterView,
} from './view.ts'

function outputObject(response: RunResult): Record<string, JsonValue> {
  if (!response.output || typeof response.output !== 'object' || Array.isArray(response.output)) {
    throw new TypeError('A kitchen Flow returned an invalid result.')
  }
  return response.output as Record<string, JsonValue>
}

function stopped(response: RunResult): RunResult | undefined {
  if (response.outcome === 'blocked' || response.outcome === 'limit') {
    const reason = outputObject(response).reason
    // A scalar may use two UTF-16 units. Bound storage before counting scalars.
    if (
      typeof reason !== 'string' ||
      reason.length === 0 ||
      reason.length > 240 * 2 ||
      Array.from(reason).length > 240
    ) {
      throw new TypeError('A stopped kitchen Flow needs a bounded reason.')
    }
    return { outcome: response.outcome, output: { reason } }
  }
  if (response.outcome !== 'done') {
    throw new TypeError('A kitchen Flow returned an unexpected outcome.')
  }
}

export async function runMethod(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
  updates?: Reporter,
): Promise<RunResult> {
  if (run.attachments.source?.access !== 'read' || run.attachments.files?.access !== 'read-write') {
    throw new TypeError('Supply read-only source and writable files attachments.')
  }
  const view = updates?.view('roster', { title: 'Saturday kitchen', landing: true })
  let state: RosterState = { phase: 'reading' }
  const present = (next: Partial<RosterState>) => {
    state = { ...state, ...next }
    view?.update(rosterView(state))
  }
  const finishStopped = (result: RunResult): RunResult => {
    present({
      phase: result.outcome as 'blocked' | 'limit',
      reason: outputObject(result).reason as string,
    })
    return result
  }
  present({})
  try {
    updates?.activity('roster', 'Reading the Saturday scenario')
    run.signal.throwIfAborted()
    const loaded = await run.call({
      operationId: 'read-scenario',
      slot: 'read-roster',
      intent: 'Read and check volunteer availability',
      input: {},
    })
    run.signal.throwIfAborted()
    const readingStop = stopped(loaded)
    if (readingStop) return finishStopped(readingStop)
    const scenario = outputObject(loaded).scenario
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
      throw new TypeError('The reading Flow omitted its scenario.')
    }

    present({ phase: 'proposing', scenario: scenario as unknown as RosterScenario })
    updates?.activity('roster', 'Asking for a complete roster proposal')
    const proposed = await run.call({
      operationId: 'propose-assignments',
      slot: 'propose-roster',
      intent: 'Consider volunteer preferences within hard constraints',
      input: { scenario },
    })
    run.signal.throwIfAborted()
    const proposalStop = stopped(proposed)
    if (proposalStop) return finishStopped(proposalStop)
    const proposal = outputObject(proposed)

    present({ phase: 'checking' })
    updates?.activity('roster', 'Checking the whole proposal before exporting')
    const checked = await run.call({
      operationId: 'check-assignments',
      slot: 'check-roster',
      intent: 'Accept only a fully checked roster',
      input: { scenario, proposal },
    })
    run.signal.throwIfAborted()
    const checkingStop = stopped(checked)
    if (checkingStop) return finishStopped(checkingStop)
    const rows = outputObject(checked).rows
    if (!Array.isArray(rows) || rows.length !== 8) {
      throw new TypeError('The checking Flow omitted its eight accepted rows.')
    }

    present({ phase: 'exporting', assignments: rows as unknown as AcceptedAssignment[] })
    updates?.activity('roster', 'Exporting the accepted roster')
    const exported = await run.call({
      operationId: 'export-assignments',
      slot: 'export-roster',
      intent: 'Write the eight accepted rows to the output packet',
      input: { rows },
    })
    run.signal.throwIfAborted()
    const exportOutput = outputObject(exported)
    if (
      exported.outcome !== 'done' ||
      exportOutput.count !== 8 ||
      exportOutput.file !== 'roster.csv'
    ) {
      throw new TypeError('The exporting Flow did not confirm the complete roster CSV.')
    }
    present({ phase: 'ready' })
    return {
      outcome: 'done',
      output: { status: 'ready', count: 8, roster: 'schedule/roster.csv', rows },
    }
  } catch (error) {
    present({
      phase: run.signal.aborted ? 'cancelled' : 'failed',
      reason: 'Scheduling stopped. Inspect Jig’s run result for the cause and any delivered files.',
    })
    throw error
  }
}

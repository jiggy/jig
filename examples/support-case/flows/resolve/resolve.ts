import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { type SupportState, supportCaseOptions, supportCaseView } from './dashboard.ts'

export async function resolve(
  run: Pick<RunContext, 'input' | 'call' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const input = run.input as SupportState['input']
  const view = reporter?.view('case', supportCaseOptions(input))
  let state: SupportState = { input, phase: 'assessing' }
  const show = (phase: SupportState['phase']) => {
    state = { ...state, phase }
    view?.update(supportCaseView(state))
  }
  show('assessing')
  try {
    // Catch inconsistent caller facts before paid interpretation. The checker
    // independently enforces this rule when invoked on its own.
    if (
      new Set(input.account.charges.map((charge) => charge.id)).size !==
      input.account.charges.length
    ) {
      throw new TypeError('Account records must have unique charge IDs.')
    }
    run.signal.throwIfAborted()
    const assessment = await run.call({
      operationId: 'assess-case',
      slot: 'assessment',
      intent: 'Interpret the disputed charge before policy checks',
      input: run.input,
    })
    run.signal.throwIfAborted()
    if (assessment.outcome === 'blocked' || assessment.outcome === 'limit') {
      state = { ...state, reason: (assessment.output as { reason: string }).reason }
      show(assessment.outcome)
      reporter?.notice(
        'The request could not be interpreted. No credit decision is available; inspect the reported cause.',
        'error',
      )
      return assessment
    }
    if (assessment.outcome !== 'done')
      throw new TypeError('The assessment returned an unexpected outcome.')
    state = { ...state, proposal: assessment.output as NonNullable<SupportState['proposal']> }
    show('checking')
    const checked = await run.call({
      operationId: 'check-credit',
      slot: 'credit',
      intent: 'Check eligibility using supplied account facts and fixed credit policy',
      input: { account: input.account, proposal: assessment.output },
    })
    run.signal.throwIfAborted()
    if (checked.outcome !== 'done') throw new TypeError('The credit checker did not complete.')
    const decision = checked.output as NonNullable<SupportState['decision']>
    if (decision.accountId !== input.account.id)
      throw new TypeError('The credit decision identifies a different account.')
    state = { ...state, decision }
    show('ready')
    return checked
  } catch (error) {
    state = {
      ...state,
      reason:
        'No complete credit decision is confirmed. Inspect the final diagnostic; no credit or message was sent.',
    }
    show(run.signal.aborted ? 'cancelled' : 'failed')
    throw error
  }
}

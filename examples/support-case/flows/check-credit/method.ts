import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { type Account, decide, type Proposal } from './policy.ts'

export async function checkCredit(
  run: Pick<RunContext, 'input' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const { account, proposal } = run.input as { account: Account; proposal: Proposal }
  run.signal.throwIfAborted()
  if (new Set(account.charges.map((charge) => charge.id)).size !== account.charges.length) {
    throw new TypeError('Account records must have unique charge IDs.')
  }
  const decision = decide(account, proposal)
  reporter?.view('credit', { title: 'Credit eligibility', landing: true }).update({
    summary: 'Eligibility was checked against supplied facts. No credit or message was sent.',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: [
              { label: 'Decision', value: decision.disposition },
              { label: 'Policy reason', value: decision.reason },
            ],
          },
          { kind: 'report', text: decision.reply },
        ],
      },
    ],
  })
  return { outcome: 'done', output: decision }
}

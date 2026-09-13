import type { RunContext, RunResult } from '@jigging/flow'
import { type Account, type Proposal, decide } from './policy.ts'

export async function resolve(
  run: Pick<RunContext, 'input' | 'runChildFlow' | 'signal'>,
): Promise<RunResult> {
  // The host checks input.schema.json; this relational check needs application code.
  const input = run.input as { message: string; account: Account }
  if (
    new Set(input.account.charges.map((charge) => charge.id)).size !== input.account.charges.length
  )
    throw new TypeError('Account records must have unique charge IDs.')
  run.signal.throwIfAborted()
  const assessment = await run.runChildFlow({
    operationId: 'assess-case',
    slot: 'assessment',
    input: run.input,
  })
  run.signal.throwIfAborted()
  if (assessment.outcome === 'blocked' || assessment.outcome === 'limit') return assessment
  if (assessment.outcome !== 'done')
    throw new TypeError('The assessment returned an unexpected outcome.')
  // The child result schema establishes shape; policy establishes eligibility.
  return { outcome: 'done', output: decide(input.account, assessment.output as Proposal) }
}

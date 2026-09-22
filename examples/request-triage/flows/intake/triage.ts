import type { RunContext, RunResult } from '@jigging/flow'

export async function triage(run: Pick<RunContext, 'input' | 'call'>): Promise<RunResult> {
  return run.call({
    operationId: 'classify-request',
    slot: 'classifier',
    input: run.input,
  })
}

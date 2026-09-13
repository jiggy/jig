import type { RunContext, RunResult } from '@jigging/flow'

export async function triage(
  run: Pick<RunContext, 'input' | 'runChildFlow'>,
): Promise<RunResult> {
  return run.runChildFlow({
    operationId: 'classify-request',
    slot: 'classifier',
    input: run.input,
  })
}

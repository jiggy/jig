import type { RunContext, RunResult } from '../src/types.ts'

console.log('application top-level log')
const cachedLog = console.log.bind(console)

export function runFlow(run: RunContext): RunResult {
  cachedLog('application cached log')
  return { outcome: 'done', output: { input: run.input } }
}

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createAttemptClient } from '@jigging/jig/client'
import { checkRoutingResult } from '@jigging/semantic-router'

// Explicit manual evaluation only. No retries or automatic prompt adjustment.
const configuration = process.env.JIG_EVAL_CONFIGURATION
if (!configuration) throw Error('Describe the selected Agent, model and limits in JIG_EVAL_CONFIGURATION. Exclude credentials.')
const cases = JSON.parse(await readFile(new URL('./evaluation-cases.json', import.meta.url), 'utf8'))
if (cases.length !== 6) throw Error('This evaluation permits exactly six fixed cases and eighteen invocations.')
const directory = 'selector-evaluation'
await mkdir(directory)
const localJig = fileURLToPath(new URL('./node_modules/.bin/jig', import.meta.url))
const executable = process.env.JIG_EXECUTABLE || (existsSync(localJig) ? localJig : execFileSync('which', ['jig'], { encoding: 'utf8' }).trim())
const client = createAttemptClient({ executable, cwd: process.cwd(), timeoutMs: 135_000 })
const inspected = await client.inspect({ target: 'binding:selector' })
const trials = []
for (const item of cases) {
  for (const variant of ['original', 'reordered', 'renamed']) {
    const mapping = new Map(item.candidates.map((candidate, index) => [candidate.id, `opaque-${17 + index * 19}`]))
    const candidates = variant === 'reordered' ? [...item.candidates].reverse()
      : variant === 'renamed' ? item.candidates.map(candidate => ({ ...candidate, id: mapping.get(candidate.id) }))
      : item.candidates
    const expected = variant === 'renamed' && item.expected !== null ? mapping.get(item.expected) : item.expected
    const record = { name: item.name, variant, expected, input: { task: item.task, candidates } }
    let owner
    try {
      const prepared = await client.prepare({
        expectedApproval: inspected.approval, target: 'binding:selector', input: record.input,
        files: [], constraints: { durationMs: 60_000, resultBytes: 32768, artifactBytes: 0 },
        outputIntent: { packet: false, receive: [] },
      })
      await writeFile(`${directory}/prepared-${trials.length}.json`, JSON.stringify(prepared), { flag: 'wx', mode: 0o600 })
      owner = await client.submit({ ticket: prepared.ticket, request: prepared.canonicalRequest })
      const observation = await owner.completion
      record.execution = { terminal: observation.terminal, cleanup: observation.cleanup }
      const result = await client.result({ ticket: prepared.ticket })
      record.decision = checkRoutingResult({ outcome: result.observation.terminal?.outcome, output: result.output }, candidates)
      record.matched = observation.terminal?.status === 'succeeded' && observation.cleanup === 'confirmed' &&
        record.decision.outcome === 'done' && record.decision.output.candidateId === expected
    } catch (error) {
      record.error = { name: error.name, ...(error.code === undefined ? {} : { code: error.code }) }
      record.matched = false
    } finally {
      if (owner) {
        try { owner.close(); await owner.completion }
        catch (error) {
          record.settlementError = { name: error.name,
            ...(error.code === undefined ? {} : { code: error.code }) }
          record.matched = false
        }
      }
      trials.push(record)
      await writeFile(`${directory}/results.json`, JSON.stringify({
        configuration, maximumAgentCalls: 18, sampleSize: trials.length,
        matched: trials.filter(trial => trial.matched).length, trials,
      }, null, 2))
    }
  }
}
console.log(`Recorded ${trials.length} trials, including every unsuccessful judgment, in ${directory}/results.json.`)

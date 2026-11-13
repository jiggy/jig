import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { studies } from './behavior-study.mjs'

const directory = process.argv[2]
if (!directory || process.argv.length !== 3)
  throw Error('Usage: node summarize-behavior.mjs RESULT_DIRECTORY')
const receipt = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
const rows = receipt.results.map((row) => {
  const expected = studies.find((study) => study.id === row.application).expected
  const answers = row.currentAnswers ?? row.answer?.answers ?? {}
  const current = row.currentAnswers !== undefined
  const omitted = Object.keys(expected).filter((key) => !Object.hasOwn(answers, key)).length
  const unknown = Object.keys(expected).filter((key) => answers[key] === 'unknown').length
  const correct = Object.keys(expected).filter((key) => answers[key] === expected[key]).length
  const wrong = Object.keys(expected).length - correct - omitted - unknown
  const usage = row.usage ?? []
  return {
    application: row.application,
    arm: row.arm,
    currentRecordedBeforeTask: current,
    correct,
    wrong,
    unknown,
    omitted,
    sourceFiles: row.readFiles.length,
    sourceToolBytes: row.sourceBytes,
    turns: row.turns,
    inputTokens: usage.reduce((sum, value) => sum + (value?.prompt_tokens ?? 0), 0),
    completionTokens: usage.reduce((sum, value) => sum + (value?.completion_tokens ?? 0), 0),
    usageUnavailable: usage.some((value) => !Number.isFinite(value?.prompt_tokens)),
    editsInScope: row.editsInScope,
    error: row.error ?? null,
    models: row.models,
  }
})
console.log(
  JSON.stringify(
    {
      protocol: receipt.protocol ?? (rows.every((row) => row.currentRecordedBeforeTask) ? 2 : 1),
      interpretation:
        'Per-application observations only. Unknown answers are abstentions, not wrong answers. In-scope edits are not proof of correct modifications. Generation and audit costs remain separate.',
      generation: receipt.generation.map(({ application, usage, returnedModel, error }) => ({
        application,
        usage,
        returnedModel,
        error,
      })),
      requests: receipt.requests,
      generationReceiptSha256: receipt.generationReceiptSha256,
      rows,
    },
    null,
    2,
  ),
)

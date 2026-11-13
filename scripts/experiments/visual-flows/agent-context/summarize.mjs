import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expected, arms, decodeScreeningResponse } from './experiment.mjs'
const directory = process.argv[2]
if (!directory || process.argv.length !== 3)
  throw Error('Usage: node summarize.mjs RECEIPT_DIRECTORY')
const receipt = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'))
const rows = []
for (const arm of arms) {
  const samples = receipt.results.filter((r) => r.arm === arm && !r.attempt)
  let correct = 0,
    wrong = 0,
    missing = 0,
    invalid = 0,
    modified = 0,
    tokens = 0
  for (const sample of samples) {
    tokens += sample.usage?.prompt_tokens ?? 0
    try {
      const { answer, schemaValid } = decodeScreeningResponse(sample.raw)
      if (!schemaValid) invalid++
      modified += Number(schemaValid && sample.modificationPassed === true)
      if (!answer?.answers || typeof answer.answers !== 'object' || Array.isArray(answer.answers)) {
        missing += Object.keys(expected).length
        continue
      }
      for (const [id, value] of Object.entries(expected)) {
        if (!Object.hasOwn(answer.answers, id)) missing++
        else if (answer.answers[id] === value) correct++
        else wrong++
      }
    } catch {
      invalid++
    }
  }
  rows.push({
    arm,
    samples: samples.length,
    correct,
    wrong,
    missing,
    invalid,
    modified,
    promptTokens: tokens,
  })
}
const models = [
  ...new Map(
    receipt.results
      .filter((row) => row.arm && !row.attempt)
      .map((row) => {
        const identity = {
          provider: row.provider ?? null,
          requestedModel: row.requestedModel ?? null,
          returnedModel: row.returnedModel ?? null,
        }
        return [JSON.stringify(identity), identity]
      }),
  ).values(),
]
const report = {
  models,
  mixedModels: models.length > 1,
  samples: receipt.results
    .filter((row) => row.arm && !row.attempt)
    .map((row) => ({
      arm: row.arm,
      repetition: row.repetition,
      provider: row.provider ?? null,
      requestedModel: row.requestedModel ?? null,
      returnedModel: row.returnedModel ?? null,
    })),
  revision: receipt.revision,
  rows,
  limitations: [
    'One application, repeated prompts per representation. Provider and model identities are recorded per sample; mixed models prevent representation-only attribution.',
    'No source-only baseline or general source extraction tested.',
    'Missing answer members are omissions, not automatically incorrect behavioral interpretations.',
    'Original source with a validated numeric edit passed nine local policy assertions per successful modification.',
    'Facts were selected and interpreted by the maintainer. No universal representation advantage is established.',
  ],
}
await writeFile(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
})
console.log(JSON.stringify(report, null, 2))

import { handle } from '@jigging/flow'

await handle(async (run) => {
  const input = run.input as { label: string; mode: string }
  if (input.mode === 'no-save') return { outcome: 'done', output: { incomplete: true } }
  const material = await run.call({
    operationId: 'material', slot: 'material', input: { label: input.label },
    attachments: { work: { create: true } },
  })
  if (material.outcome !== 'done' || !material.artifacts?.work) throw Error('No draft material.')
  await run.call({
    operationId: 'save', slot: 'checkpoint',
    input: {
      sequence: 1, evidence: { label: input.label, status: 'partial' },
      files: {
        'context.json': JSON.stringify({
          label: input.label,
          paragraphs: input.mode === 'bad-context' ? [] : [`Partial draft for ${input.label}.`],
        }),
      },
      artifacts: { material: material.artifacts.work.reference },
    },
  })
  if (input.mode !== 'reject') {
    await run.release({ operationId: 'release-material', artifact: material.artifacts.work })
    throw Error('Demonstration: worker failed after saving useful partial work.')
  }
  return {
    outcome: 'done', output: { incomplete: true },
    artifactResults: { report: material.artifacts.work },
  }
})

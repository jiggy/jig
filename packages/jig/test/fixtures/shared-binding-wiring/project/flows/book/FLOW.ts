import { handle } from '@jigging/flow'

await handle(async (run) => {
  const result = await run.call({
    operationId: 'book-manuscript',
    slot: 'producer',
    input: run.input,
    attachments: { review: { create: true } },
  })
  if (result.outcome !== 'done' || !result.artifacts?.review) {
    throw new Error('Book review packet is missing.')
  }
  return {
    outcome: 'done',
    output: { book: result.output },
    artifactResults: { review: result.artifacts.review },
  }
})

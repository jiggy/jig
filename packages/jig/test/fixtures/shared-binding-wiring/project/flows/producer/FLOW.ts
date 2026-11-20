import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { handle, type JsonValue } from '@jigging/flow'

await handle(async (run) => {
  const reviews: JsonValue[] = []
  const chapter = async (operationId: string, edited: boolean, text: string) => {
    const result = await run.call({
      operationId,
      slot: edited ? 'post-edit' : 'review',
      input: { scope: 'chapter', purpose: edited ? 'post-edit' : 'developmental', text },
    })
    if (result.outcome !== 'done') throw new Error('Chapter review did not finish.')
    reviews.push(result.output)
  }

  if (run.input === 'resumed') {
    await chapter('resumed-chapter', true, 'Epilogue')
  } else {
    await chapter('draft-chapter', false, 'Introduction')
    await chapter('edited-chapter', true, 'Chapter One')
  }

  const book = await run.call({
    operationId: 'whole-book',
    slot: 'review',
    input: { scope: 'book', purpose: 'post-edit', text: 'Complete manuscript' },
  })
  if (book.outcome !== 'done') throw new Error('Whole-book review did not finish.')
  reviews.push(book.output)

  const output = { reviews }
  await writeFile(join(run.attachments.review.path, 'report.json'), `${JSON.stringify(output)}\n`)
  return { outcome: 'done', output }
})

import { handle } from '@jigging/flow'
import { copyFile, readFile, writeFile } from 'node:fs/promises'

await handle(async (run) => {
  const { label, paragraphs, mode } = run.input as {
    label: string; paragraphs: string[]; mode: string
  }
  const source = run.attachments.source!.path
  const destination = run.attachments.report!.path
  // The fallback receives an immutable snapshot, including the producer's associated tree.
  const original = await readFile(`${source}/artifacts/material/draft.txt`, 'utf8')
  if (original !== paragraphs[0]) throw Error('The adapted draft does not match its saved material.')
  for (const name of ['binary.bin', 'empty.bin'])
    await copyFile(`${source}/artifacts/material/${name}`, `${destination}/${name}`)
  const report = mode === 'bad-fallback' ? 'Incomplete replacement.' : `${paragraphs.join('\n')}\nCompleted for ${label}.\n`
  await writeFile(`${destination}/report.txt`, report)
  return { outcome: 'done', output: { label, completed: true } }
})

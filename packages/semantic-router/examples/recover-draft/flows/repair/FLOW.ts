import { handle } from '@jigging/flow'
import { readFile } from 'node:fs/promises'

await handle(async (run) => {
  const { label } = run.input as { label: string }
  const source = run.attachments.source!.path
  const context = JSON.parse(await readFile(`${source}/context.json`, 'utf8'))
  // This application accepts only its own draft format. The selector never adapts schemas.
  if (
    !context || Object.keys(context).sort().join(',') !== 'label,paragraphs' ||
    context.label !== label || !Array.isArray(context.paragraphs) ||
    context.paragraphs.length !== 1 || context.paragraphs[0] !== `Partial draft for ${label}.`
  ) return { outcome: 'blocked', output: { reason: 'Retained draft data failed domain validation.' } }
  const binary = await readFile(`${source}/artifacts/material/binary.bin`)
  const empty = await readFile(`${source}/artifacts/material/empty.bin`)
  if (!binary.equals(Buffer.from([0, 255, 128])) || empty.length !== 0)
    return { outcome: 'blocked', output: { reason: 'Retained binary material failed validation.' } }
  return { outcome: 'done', output: { label, paragraphs: context.paragraphs } }
})

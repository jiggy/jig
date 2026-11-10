import { handle } from '@jigging/flow'
import { writeFile } from 'node:fs/promises'

await handle(async (run) => {
  const { label } = run.input as { label: string }
  const work = run.attachments.work!.path
  await writeFile(`${work}/draft.txt`, `Partial draft for ${label}.`)
  await writeFile(`${work}/binary.bin`, new Uint8Array([0, 255, 128]))
  await writeFile(`${work}/empty.bin`, new Uint8Array())
  return { outcome: 'done', output: { created: true } }
})

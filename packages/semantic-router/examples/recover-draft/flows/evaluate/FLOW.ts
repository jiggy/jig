import { handle } from '@jigging/flow'
import { readFile } from 'node:fs/promises'

await handle(async (run) => {
  const { label } = run.input as { label: string }
  const source = run.attachments.source!.path
  const report = await readFile(`${source}/report.txt`, 'utf8').catch(() => null)
  const binary = await readFile(`${source}/binary.bin`)
  const empty = await readFile(`${source}/empty.bin`)
  const accepted = report === `Partial draft for ${label}.\nCompleted for ${label}.\n` &&
    binary.equals(Buffer.from([0, 255, 128])) && empty.length === 0
  return {
    outcome: 'done',
    output: { accepted, reason: accepted ? 'Complete report and unchanged binary material.' : 'Report or material failed acceptance.' },
  }
})

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'

type Preview = { status: 'ready' | 'needs_mapping'; accepted: unknown[]; rejected: unknown[] }

export async function exportPreview(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const files = run.attachments.files
  if (files?.access !== 'read-write') throw new TypeError('Supply a writable files attachment.')
  const preview = run.input as Preview
  run.signal.throwIfAborted()
  await writeFile(join(files.path, 'preview.json'), JSON.stringify(preview, null, 2) + '\n', {
    flag: 'wx',
  })
  run.signal.throwIfAborted()
  reporter?.view('preview', { title: 'Exported contact preview', landing: true }).update({
    summary:
      'The supplied preview was written. The caller owns row acceptance; no contacts were imported.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Read the complete supplied preview.',
            references: [{ kind: 'artifact', attachment: 'files', path: 'preview.json' }],
          },
        ],
      },
    ],
  })
  return {
    outcome: 'done',
    output: {
      file: 'preview.json',
      status: preview.status,
      accepted: preview.accepted.length,
      rejected: preview.rejected.length,
    },
  }
}

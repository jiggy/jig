import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { readProject } from './capture.ts'

export async function captureProject(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  reporter?: Reporter,
): Promise<RunResult> {
  const source = run.attachments.source
  if (source?.access !== 'read') throw new TypeError('Supply a read-only source attachment.')
  run.signal.throwIfAborted()
  const captured = await readProject(run.input, source.path)
  run.signal.throwIfAborted()
  reporter?.view('project', { title: 'Captured project', landing: true }).update({
    summary:
      'Source was captured without executing it. Acceptance cases come from reviewed package data.',
    sections: [
      {
        blocks: [
          {
            kind: 'facts',
            items: [
              { label: 'Captured files', value: Object.keys(captured.files).length },
              { label: 'Editable files', value: captured.editPaths.length },
              { label: 'Acceptance cases', value: captured.cases.length },
            ],
          },
        ],
      },
    ],
  })
  return { outcome: 'done', output: captured }
}

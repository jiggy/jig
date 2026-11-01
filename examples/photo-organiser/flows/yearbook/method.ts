import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { validateAssignments } from './assignments.ts'
import { capturePhotos } from './catalogue.ts'
import { renderYearbook } from './rendering.ts'

export async function createYearbook(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  const source = run.attachments.source
  const files = run.attachments.files
  if (source?.access !== 'read' || files?.access !== 'read-write')
    throw new TypeError('Supply read-only source and writable files attachments.')
  if (
    !run.input ||
    typeof run.input !== 'object' ||
    Array.isArray(run.input) ||
    Object.keys(run.input).length !== 2 ||
    !Object.hasOwn(run.input, 'title') ||
    !Object.hasOwn(run.input, 'assignments')
  ) {
    throw new TypeError('Supply exactly a yearbook title and assignments.')
  }
  const input = run.input as { title?: unknown; assignments?: unknown }
  if (
    !input ||
    typeof input.title !== 'string' ||
    !input.title.length ||
    [...input.title].length > 128
  )
    throw new TypeError('Supply a yearbook title of 1–128 characters.')
  const { photos, images } = await capturePhotos(source.path, run.signal)
  const assignments = validateAssignments(photos, { assignments: input.assignments })
  updates?.activity('yearbook', 'Preparing the printable yearbook')
  const { bytes, pages } = await renderYearbook(
    input.title,
    assignments,
    images,
    run.signal,
    (photos[1] ?? photos[0])?.id,
  )
  run.signal.throwIfAborted()
  await writeFile(join(files.path, 'yearbook.pdf'), bytes, { flag: 'wx' })
  run.signal.throwIfAborted()
  updates?.view('yearbook', { title: 'Yearbook' }).update({
    summary: `${pages} printable pages prepared from ${photos.length} photographs.`,
    sections: [
      {
        blocks: [
          {
            kind: 'content',
            title: 'Printable yearbook',
            reference: { kind: 'artifact', attachment: 'files', path: 'yearbook.pdf' },
          },
        ],
      },
    ],
  })
  updates?.clear('yearbook')
  return {
    outcome: 'done',
    output: { count: photos.length, pages, bytes: bytes.length, file: 'yearbook.pdf' },
  }
}

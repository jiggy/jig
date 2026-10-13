import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { validateAssignments } from './assignments.ts'
import { capturePhotos } from './catalogue.ts'
import { writeCopies } from './copies.ts'
import { createManifest } from './manifest.ts'
import { copiesView } from './view.ts'

export async function copyPhotos(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  const sourceAttachment = run.attachments.source
  const outputAttachment = run.attachments.files
  if (sourceAttachment?.access !== 'read' || outputAttachment?.access !== 'read-write') {
    throw new TypeError('Supply read-only source and writable files attachments.')
  }

  const view = updates?.view('copies', { title: 'Photo copies', landing: true })
  view?.update(copiesView())

  // This is an independent boundary: never trust a caller's claim that it checked a plan.
  updates?.activity('copy-photos', 'Reading every original image')
  run.signal.throwIfAborted()
  const { photos, images } = await capturePhotos(sourceAttachment.path, run.signal)
  run.signal.throwIfAborted()

  updates?.activity('copy-photos', 'Checking all assignments and destinations')
  const renamedPhotos = validateAssignments(photos, run.input)
  const manifest = createManifest(renamedPhotos)

  updates?.activity('copy-photos', 'Writing byte-preserving copies and the manifest')
  await writeCopies(outputAttachment.path, renamedPhotos, images, run.signal)
  run.signal.throwIfAborted()
  await writeFile(join(outputAttachment.path, 'manifest.csv'), manifest, { flag: 'wx' })
  run.signal.throwIfAborted()
  view?.update(copiesView(renamedPhotos, true))

  return {
    outcome: 'done',
    output: {
      count: renamedPhotos.length,
      photos: renamedPhotos,
      manifest: 'manifest.csv',
    },
  }
}

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { validateAssignments } from './assignments.ts'
import { capturePhotos } from './catalogue.ts'
import { createContactSheet } from './rendering.ts'
import { contactSheetView } from './view.ts'

export async function createPhotoContactSheet(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  const sourceAttachment = run.attachments.source
  const outputAttachment = run.attachments.files
  if (sourceAttachment?.access !== 'read' || outputAttachment?.access !== 'read-write') {
    throw new TypeError('Supply read-only source and writable files attachments.')
  }

  const view = updates?.view('contact-sheet', { title: 'Contact sheet', landing: true })
  view?.update(contactSheetView())

  // This method can run on its own. Check the originals and assignments here too.
  updates?.activity('contact-sheet', 'Reading every original image')
  run.signal.throwIfAborted()
  const { photos, images } = await capturePhotos(sourceAttachment.path, run.signal)
  run.signal.throwIfAborted()

  updates?.activity('contact-sheet', 'Checking every assignment and rendering the sheet')
  const renamedPhotos = validateAssignments(photos, run.input)
  const contactSheet = createContactSheet(photos, renamedPhotos, images)

  run.signal.throwIfAborted()
  await writeFile(join(outputAttachment.path, 'contact-sheet.svg'), contactSheet, { flag: 'wx' })
  run.signal.throwIfAborted()
  view?.update(contactSheetView(photos.length, true))

  return {
    outcome: 'done',
    output: { count: photos.length, contactSheet: 'contact-sheet.svg' },
  }
}

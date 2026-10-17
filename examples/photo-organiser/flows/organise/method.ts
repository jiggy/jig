import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { capturePhotos } from './catalogue.ts'
import { checkContactSheetOutput, checkCopiedPhotos, checkProposal } from './plan.ts'
import { photosView } from './view.ts'

export async function organisePhotos(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
  updates?: Reporter,
): Promise<RunResult> {
  const sourceAttachment = run.attachments.source
  if (sourceAttachment?.access !== 'read') {
    throw new TypeError('Supply the read-only source attachment.')
  }

  const view = updates?.view('photos', { title: 'Photo box', landing: true })
  view?.update(photosView())

  // 1. Read and check all source files before requesting an Agent proposal.
  updates?.activity('organise', 'Reading photos and captions')
  run.signal.throwIfAborted()
  const { photos } = await capturePhotos(sourceAttachment.path, run.signal)
  run.signal.throwIfAborted()

  // 2. Pass captions to the grouping Flow, without filenames or image bytes.
  const captions = photos.map((photo) => ({
    id: photo.id,
    date: photo.date,
    caption: photo.caption,
  }))
  updates?.activity('organise', 'Grouping captions with the grouping Flow')
  const groupingResponse = await run.call({
    operationId: 'group-photos',
    slot: 'group',
    intent: 'Suggest event groups without accessing photo files',
    input: { photos: captions },
  })
  run.signal.throwIfAborted()

  if (groupingResponse.outcome === 'blocked' || groupingResponse.outcome === 'limit') {
    const reason = (groupingResponse.output as { reason?: unknown })?.reason
    if (typeof reason !== 'string') {
      throw new TypeError('The grouping Flow omitted its reason for stopping.')
    }
    updates?.notice(
      'Photo grouping could not complete. No copies were prepared. See the final cause.',
      'error',
    )
    return { outcome: groupingResponse.outcome, output: { reason } }
  }
  if (groupingResponse.outcome !== 'done') {
    throw new TypeError('Unexpected grouping outcome.')
  }

  // 3. Accept the complete proposal before creating any output files.
  updates?.activity('organise', 'Checking every assignment and destination')
  const renamedPhotos = checkProposal(photos, groupingResponse.output)
  const assignments = renamedPhotos.map((photo) => ({ id: photo.id, event: photo.event }))

  // 4. Each file Flow rechecks the originals and assignments at its own boundary.
  // The Binding supplies the immutable source and permits fresh operation outputs.
  updates?.activity('organise', 'Preparing checked photo copies and the manifest')
  const copyResponse = await run.call({
    operationId: 'copy-photos',
    slot: 'copy-photos',
    intent: 'Copy the originals into checked event folders without changing their bytes',
    input: { assignments },
    attachments: { files: { create: true } },
  })
  run.signal.throwIfAborted()
  if (copyResponse.outcome !== 'done') {
    throw new TypeError('The copy Flow did not complete the checked collection.')
  }
  checkCopiedPhotos(renamedPhotos, copyResponse.output)
  const copies = copyResponse.artifacts?.files
  if (copies === undefined) {
    throw new TypeError('The copy Flow omitted its sealed file artifact.')
  }

  updates?.activity('organise', 'Creating the before-and-after contact sheet')
  const sheetResponse = await run.call({
    operationId: 'create-contact-sheet',
    slot: 'contact-sheet',
    intent: 'Show the original collection beside its checked grouping',
    input: { assignments },
    attachments: { files: { create: true } },
  })
  run.signal.throwIfAborted()
  if (sheetResponse.outcome !== 'done') {
    throw new TypeError('The contact-sheet Flow did not complete the overview.')
  }
  checkContactSheetOutput(renamedPhotos.length, sheetResponse.output)
  const overview = sheetResponse.artifacts?.files
  if (overview === undefined) {
    throw new TypeError('The contact-sheet Flow omitted its sealed file artifact.')
  }

  // Final result names supply packet prefixes without copying or mutating either
  // sealed child tree. Leaf paths remain relative to their own output attachment.
  const deliveredPhotos = renamedPhotos.map((photo) => ({
    ...photo,
    destination: `copies/${photo.destination}`,
  }))
  view?.update(photosView(deliveredPhotos, true))

  const eventGroups = [...new Set(renamedPhotos.map((photo) => photo.event))]
  return {
    outcome: 'done',
    output: {
      status: 'organised',
      count: renamedPhotos.length,
      groups: eventGroups,
      photos: deliveredPhotos,
      manifest: 'copies/manifest.csv',
      contactSheet: 'overview/contact-sheet.svg',
    },
    artifactResults: { copies, overview },
  }
}

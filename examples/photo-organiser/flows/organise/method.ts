import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { capturePhotos } from './catalogue.ts'
import { checkProposal } from './plan.ts'
import { deliverPhotos } from './delivery.ts'
import { photosView } from './view.ts'

export async function organisePhotos(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
  updates?: Reporter,
): Promise<RunResult> {
  const sourceAttachment = run.attachments.source
  const outputAttachment = run.attachments.photos
  if (sourceAttachment?.access !== 'read' || outputAttachment?.access !== 'read-write') {
    throw new TypeError('Supply read-only source and writable photos attachments.')
  }

  const view = updates?.view('photos', { title: 'Photo box', landing: true })
  view?.update(photosView())

  // 1. Read and check all source files before requesting an Agent proposal.
  updates?.activity('organise', 'Reading photos and captions')
  run.signal.throwIfAborted()
  const { photos, images } = await capturePhotos(sourceAttachment.path, run.signal)
  run.signal.throwIfAborted()

  // 2. Pass captions to the grouping Flow; keep filenames and images here.
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
      'Photo grouping could not complete; no copies were prepared. See the final cause.',
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
  await deliverPhotos(outputAttachment.path, photos, renamedPhotos, images, run.signal)
  view?.update(photosView(renamedPhotos, true))

  const eventGroups = [...new Set(renamedPhotos.map((photo) => photo.event))]
  return {
    outcome: 'done',
    output: {
      status: 'organised',
      count: renamedPhotos.length,
      groups: eventGroups,
      photos: renamedPhotos,
      manifest: 'manifest.csv',
      contactSheet: 'contact-sheet.svg',
    },
  }
}

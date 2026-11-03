import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter, ReportingView } from '@jigging/reporting'
import { capturePhotos } from './catalogue.ts'
import { checkContactSheetOutput, checkCopiedPhotos, checkProposal } from './plan.ts'
import {
  type PhotoBoxState,
  photoAlbumKey,
  photoBoxView,
  photoYearbookView,
  photoGalleryView,
  photoViewOptions,
} from './view.ts'

export async function organisePhotos(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
  updates?: Reporter,
): Promise<RunResult> {
  const sourceAttachment = run.attachments.source
  if (sourceAttachment?.access !== 'read') {
    throw new TypeError('Supply a read-only source attachment.')
  }

  const reading = updates?.view('reading', { title: 'Reading photos', application: 'Photo studio' })
  let views: Readonly<Record<'photos' | 'organise' | 'yearbook', ReportingView>> | undefined
  const albumTitle = (run.input as { albumTitle?: string })?.albumTitle ?? 'Photo collection'
  let state: PhotoBoxState = { phase: 'reading', albumTitle }
  const show = (phase: PhotoBoxState['phase']) => {
    state = { ...state, phase }
    if (views) {
      views.photos.update(photoGalleryView(state))
      views.organise.update(photoBoxView(state))
      views.yearbook.update(photoYearbookView(state))
    } else {
      reading?.update(photoBoxView(state))
    }
  }
  show('reading')

  try {
    // 1. Read and check all source files before requesting an Agent proposal.
    updates?.activity('organise', 'Reading photos and captions')
    run.signal.throwIfAborted()
    const { photos } = await capturePhotos(sourceAttachment.path, run.signal)
    run.signal.throwIfAborted()

    state = { ...state, photos }
    if (updates) {
      reading?.retire()
      const options = photoViewOptions(photoAlbumKey(photos), albumTitle)
      views = {
        photos: updates.view('photos', options.photos),
        organise: updates.view('organise', options.organise),
        yearbook: updates.view('yearbook', options.yearbook),
      }
    }
    show('grouping')

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
      state = { ...state, reason }
      show(groupingResponse.outcome)
      return { outcome: groupingResponse.outcome, output: { reason } }
    }
    if (groupingResponse.outcome !== 'done') {
      throw new TypeError('Unexpected grouping outcome.')
    }

    show('checking')
    // 3. Accept the complete proposal before creating any output files.
    updates?.activity('organise', 'Checking every assignment and destination')
    const renamedPhotos = checkProposal(photos, groupingResponse.output)
    const assignments = renamedPhotos.map((photo) => ({ id: photo.id, event: photo.event }))

    state = {
      ...state,
      plan: renamedPhotos.map((photo) => ({
        ...photo,
        destination: `copies/${photo.destination}`,
      })),
    }
    show('copying')

    // 4. Each file Flow rechecks the originals and assignments at its own boundary.
    // The Binding lends the source and permits fresh operation-owned outputs.
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
    if (!copies) {
      throw new TypeError('The copy Flow omitted its immutable files artifact.')
    }

    show('contact-sheet')
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
    if (!overview) {
      throw new TypeError('The contact-sheet Flow omitted its immutable files artifact.')
    }

    show('yearbook')
    updates?.activity('organise', 'Preparing the printable yearbook')
    const bookResponse = await run.call({
      operationId: 'create-yearbook',
      slot: 'yearbook',
      intent: 'Prepare a printable yearbook from the checked photographs and event grouping',
      input: { title: albumTitle, assignments },
      attachments: { files: { create: true } },
    })
    run.signal.throwIfAborted()
    const bookOutput = bookResponse.output as {
      count?: unknown
      pages?: unknown
      bytes?: unknown
      file?: unknown
    }
    const expectedPages =
      renamedPhotos.length + new Set(renamedPhotos.map((photo) => photo.event)).size + 3
    if (
      bookResponse.outcome !== 'done' ||
      bookOutput?.count !== renamedPhotos.length ||
      bookOutput?.pages !== expectedPages ||
      bookOutput?.file !== 'yearbook.pdf' ||
      typeof bookOutput.bytes !== 'number' ||
      !Number.isSafeInteger(bookOutput.bytes) ||
      bookOutput.bytes <= 0
    )
      throw new TypeError('The yearbook Flow omitted its checked document metadata.')
    const book = bookResponse.artifacts?.files
    if (!book) throw new TypeError('The yearbook Flow omitted its immutable files artifact.')
    state = { ...state, yearbook: { pages: expectedPages, bytes: bookOutput.bytes } }

    // Final artifact names supply packet prefixes. Leaf paths stay relative.
    const deliveredPhotos = renamedPhotos.map((photo) => ({
      ...photo,
      destination: `copies/${photo.destination}`,
    }))
    show('ready')

    const eventGroups = [...new Set(renamedPhotos.map((photo) => photo.event))]
    return {
      outcome: 'done',
      artifactResults: { copies, overview, book },
      output: {
        status: 'organised',
        count: renamedPhotos.length,
        groups: eventGroups,
        photos: deliveredPhotos,
        manifest: 'copies/manifest.csv',
        contactSheet: 'overview/contact-sheet.svg',
        yearbook: 'book/yearbook.pdf',
        pages: expectedPages,
      },
    }
  } catch (error) {
    state = {
      ...state,
      reason:
        'No complete collection is confirmed. Inspect the final diagnostic and any delivered files; originals stay unchanged.',
    }
    show(run.signal.aborted ? 'cancelled' : 'failed')
    throw error
  }
}

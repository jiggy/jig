import type { Photo } from './catalogue.ts'

export type RenamedPhoto = Photo & {
  event: string
  destination: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactlyFields(record: Record<string, unknown>, fields: string[]): boolean {
  return (
    Object.keys(record).length === fields.length &&
    fields.every((field) => Object.hasOwn(record, field))
  )
}

export function checkProposal(photos: Photo[], proposal: unknown): RenamedPhoto[] {
  if (!isRecord(proposal) || !hasExactlyFields(proposal, ['assignments'])) {
    throw new TypeError('The grouping proposal must contain only assignments.')
  }
  if (!Array.isArray(proposal.assignments) || proposal.assignments.length !== photos.length) {
    throw new TypeError('Assign every photo exactly once.')
  }

  const photosById = new Map(photos.map((photo) => [photo.id, photo]))
  const assignedIds = new Set<string>()
  const destinationPaths = new Set<string>()
  const eventLabelsByFolder = new Map<string, string>()
  const renamedPhotos: RenamedPhoto[] = []

  for (const assignment of proposal.assignments) {
    if (!isRecord(assignment) || !hasExactlyFields(assignment, ['id', 'event'])) {
      throw new TypeError('Each assignment needs exactly a photo ID and an event label.')
    }

    const { id, event } = assignment
    if (typeof id !== 'string' || !photosById.has(id)) {
      throw new TypeError('Assignments must use known photo IDs.')
    }
    if (assignedIds.has(id)) {
      throw new TypeError('A photo ID cannot be assigned more than once.')
    }
    if (
      typeof event !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9 -]{0,47}$/.test(event) ||
      event.trim() !== event
    ) {
      throw new TypeError(
        'Use a short event label made of letters, numbers, spaces or hyphens, without surrounding spaces.',
      )
    }

    // Spaces and hyphens become one separator: "Lake Picnic" becomes "lake-picnic".
    const eventFolder = event.toLowerCase().replace(/[ -]+/g, '-').replace(/-$/, '')
    const previousLabel = eventLabelsByFolder.get(eventFolder)
    if (previousLabel !== undefined && previousLabel !== event) {
      throw new TypeError(
        'Different event labels normalize to the same group. Choose one consistent label.',
      )
    }

    const photo = photosById.get(id)!
    const extension = photo.file.slice(photo.file.lastIndexOf('.'))
    const filename = `${photo.date}_${eventFolder}_${photo.id}${extension}`
    const destination = `${eventFolder}/${filename}`
    const normalizedDestination = destination.toLowerCase()
    if (destinationPaths.has(normalizedDestination)) {
      throw new TypeError('Destination filenames collide.')
    }

    assignedIds.add(id)
    destinationPaths.add(normalizedDestination)
    eventLabelsByFolder.set(eventFolder, event)
    renamedPhotos.push({ ...photo, event, destination })
  }

  return renamedPhotos.sort((firstPhoto, secondPhoto) =>
    firstPhoto.destination.localeCompare(secondPhoto.destination),
  )
}

/** Accept child metadata only when it describes the collection already checked here. */
export function checkCopiedPhotos(expectedPhotos: RenamedPhoto[], output: unknown): void {
  if (!isRecord(output) || !hasExactlyFields(output, ['count', 'photos', 'manifest'])) {
    throw new TypeError('The copy Flow must return its count, photos and manifest.')
  }
  if (output.count !== expectedPhotos.length || output.manifest !== 'manifest.csv') {
    throw new TypeError('The copy Flow returned an incomplete collection or unexpected manifest.')
  }
  if (!Array.isArray(output.photos) || output.photos.length !== expectedPhotos.length) {
    throw new TypeError('The copy Flow must account for every checked photo.')
  }

  const fields = ['id', 'file', 'date', 'caption', 'event', 'destination'] as const
  const remainingPhotos = new Map(expectedPhotos.map((photo) => [photo.id, photo]))
  for (const returnedPhoto of output.photos) {
    if (!isRecord(returnedPhoto) || !hasExactlyFields(returnedPhoto, [...fields])) {
      throw new TypeError('The copy Flow returned invalid photo metadata.')
    }
    if (typeof returnedPhoto.id !== 'string') {
      throw new TypeError('The copy Flow omitted a photo ID.')
    }
    const expectedPhoto = remainingPhotos.get(returnedPhoto.id)
    if (expectedPhoto === undefined) {
      throw new TypeError('The copy Flow repeated or introduced a photo ID.')
    }
    for (const field of fields) {
      if (returnedPhoto[field] !== expectedPhoto[field]) {
        throw new TypeError('The copied collection differs from the accepted photo plan.')
      }
    }
    remainingPhotos.delete(expectedPhoto.id)
  }
}

export function checkContactSheetOutput(expectedCount: number, output: unknown): void {
  if (!isRecord(output) || !hasExactlyFields(output, ['count', 'contactSheet'])) {
    throw new TypeError('The contact-sheet Flow must return its count and sheet path.')
  }
  if (output.count !== expectedCount || output.contactSheet !== 'contact-sheet.svg') {
    throw new TypeError('The contact sheet does not describe the complete checked collection.')
  }
}

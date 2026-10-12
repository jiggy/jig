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
        'Different event labels normalize to the same group; choose one consistent label.',
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

import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

export type Photo = {
  id: string
  file: string
  date: string
  caption: string
}

const MAX_PHOTOS = 12
const MAX_CATALOGUE_BYTES = 8 * 1024
const MAX_IMAGE_BYTES = 256 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactlyFields(record: Record<string, unknown>, fields: string[]): boolean {
  return (
    Object.keys(record).length === fields.length &&
    fields.every((field) => Object.hasOwn(record, field))
  )
}

function readPhoto(record: unknown): Photo {
  if (!isRecord(record) || !hasExactlyFields(record, ['id', 'file', 'date', 'caption'])) {
    throw new TypeError('Each photo needs exactly an id, file, date and caption.')
  }

  const { id, file, date, caption } = record

  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) {
    throw new TypeError('Photo IDs must contain 1–32 letters, digits, hyphens or underscores.')
  }

  if (typeof file !== 'string' || !/^[a-zA-Z0-9_-]{1,64}\.(svg|png|jpg|jpeg)$/.test(file)) {
    throw new TypeError('Use a simple SVG, PNG or JPEG filename without folders.')
  }

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('Photo dates must use YYYY-MM-DD.')
  }
  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new TypeError('Photo dates must be real calendar dates.')
  }

  if (typeof caption !== 'string' || caption.length < 1 || caption.length > 240) {
    throw new TypeError('Photo captions must contain 1–240 characters.')
  }
  if (Buffer.from(caption, 'utf8').toString('utf8') !== caption) {
    throw new TypeError('Photo captions must contain valid Unicode characters.')
  }
  const containsControlCharacters = [...caption].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (containsControlCharacters) {
    throw new TypeError('Photo captions cannot contain control characters.')
  }

  return { id, file, date, caption }
}

export function readCatalogue(value: unknown): Photo[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PHOTOS) {
    throw new TypeError('Supply 1–12 photo records.')
  }

  const photos: Photo[] = []
  const knownIds = new Set<string>()
  const knownFilenames = new Set<string>()

  for (const record of value) {
    const photo = readPhoto(record)
    const normalizedId = photo.id.toLowerCase()
    const normalizedFilename = photo.file.toLowerCase()

    if (knownIds.has(normalizedId) || knownFilenames.has(normalizedFilename)) {
      throw new TypeError('Photo IDs and filenames must be unique, including when case is ignored.')
    }

    knownIds.add(normalizedId)
    knownFilenames.add(normalizedFilename)
    photos.push(photo)
  }

  return photos
}

async function readSourceFile(
  sourceFolder: string,
  filename: string,
  maximumBytes: number,
): Promise<Buffer> {
  // Do not follow symlinks or block on special files in the supplied source.
  const file = await open(
    join(sourceFolder, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  )
  try {
    const information = await file.stat()
    if (!information.isFile() || information.size > maximumBytes) {
      throw new TypeError(`${filename} must be a bounded regular file.`)
    }

    const bytes = await file.readFile()
    if (bytes.length !== information.size || bytes.length > maximumBytes) {
      throw new TypeError(`Incomplete or oversized ${filename}.`)
    }
    return bytes
  } finally {
    await file.close()
  }
}

function checkImage(filename: string, bytes: Buffer): void {
  if (bytes.length === 0) {
    throw new TypeError('Photos cannot be empty.')
  }

  if (filename.endsWith('.svg')) {
    // This small fixture format excludes executable markup and resource references.
    const svg = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const forbiddenSvgContent =
      /<!|<\?|<\s*\/?\s*(script|foreignObject|style|image|use|a)\b|\bon\w+\s*=|\bhref\s*=|url\s*\(/i
    if (!svg.startsWith('<svg ') || forbiddenSvgContent.test(svg)) {
      throw new TypeError(
        'SVG fixtures must be inert illustrations without links, scripts or embedded resources.',
      )
    }
    return
  }

  if (filename.endsWith('.png')) {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    if (!bytes.subarray(0, 8).equals(pngSignature)) {
      throw new TypeError('Invalid PNG signature.')
    }
    return
  }

  const hasJpegSignature = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (!hasJpegSignature) {
    throw new TypeError('Invalid JPEG signature.')
  }
}

export async function capturePhotos(sourceFolder: string, signal: AbortSignal) {
  const catalogueBytes = await readSourceFile(sourceFolder, 'photos.json', MAX_CATALOGUE_BYTES)
  const catalogueText = new TextDecoder('utf-8', { fatal: true }).decode(catalogueBytes)
  const photos = readCatalogue(JSON.parse(catalogueText))
  const images = new Map<string, Buffer>()

  // Capture every original before accepting assignments or creating output files.
  for (const photo of photos) {
    signal.throwIfAborted()
    const imageBytes = await readSourceFile(sourceFolder, photo.file, MAX_IMAGE_BYTES)
    checkImage(photo.file, imageBytes)
    images.set(photo.id, imageBytes)
  }

  return { photos, images }
}

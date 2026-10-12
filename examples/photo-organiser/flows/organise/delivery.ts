import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Photo } from './catalogue.ts'
import type { RenamedPhoto } from './plan.ts'
import { createContactSheet } from './contact-sheet.ts'

function quoteCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function createManifest(photos: RenamedPhoto[]): string {
  const lines = ['id,original,event,date,copy']
  for (const photo of photos) {
    const fields = [photo.id, photo.file, photo.event, photo.date, photo.destination]
    lines.push(fields.map(quoteCsvField).join(','))
  }
  return lines.join('\n') + '\n'
}

export async function deliverPhotos(
  outputFolder: string,
  originalPhotos: Photo[],
  renamedPhotos: RenamedPhoto[],
  images: Map<string, Buffer>,
  signal: AbortSignal,
) {
  const contactSheet = createContactSheet(originalPhotos, renamedPhotos, images)
  const manifest = createManifest(renamedPhotos)

  // The caller has captured all images and checked every assignment before this stage.
  // Exclusive creation refuses to overwrite an existing output file.
  for (const photo of renamedPhotos) {
    signal.throwIfAborted()
    const eventFolder = photo.destination.split('/')[0]!
    const destination = join(outputFolder, photo.destination)
    const imageBytes = images.get(photo.id)!

    await mkdir(join(outputFolder, eventFolder), { recursive: true })
    await writeFile(destination, imageBytes, { flag: 'wx' })
  }

  signal.throwIfAborted()
  await writeFile(join(outputFolder, 'manifest.csv'), manifest, { flag: 'wx' })
  await writeFile(join(outputFolder, 'contact-sheet.svg'), contactSheet, { flag: 'wx' })
}

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RenamedPhoto } from './assignments.ts'

export async function writeCopies(
  outputFolder: string,
  photos: RenamedPhoto[],
  images: Map<string, Buffer>,
  signal: AbortSignal,
): Promise<void> {
  // The method has checked every original and assignment before entering here.
  // Exclusive creation leaves existing output files untouched if a name collides.
  for (const photo of photos) {
    signal.throwIfAborted()
    const eventFolder = dirname(photo.destination)
    const destination = join(outputFolder, photo.destination)
    const originalBytes = images.get(photo.id)
    if (originalBytes === undefined) {
      throw new TypeError('Every copy requires its captured original image.')
    }

    await mkdir(join(outputFolder, eventFolder), { recursive: true })
    signal.throwIfAborted()
    await writeFile(destination, originalBytes, { flag: 'wx' })
  }
}

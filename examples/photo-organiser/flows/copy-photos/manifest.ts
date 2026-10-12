import type { RenamedPhoto } from './assignments.ts'

function quoteCsvField(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function createManifest(photos: RenamedPhoto[]): string {
  const lines = ['id,original,event,date,copy']

  for (const photo of photos) {
    const fields = [photo.id, photo.file, photo.event, photo.date, photo.destination]
    lines.push(fields.map(quoteCsvField).join(','))
  }

  return `${lines.join('\n')}\n`
}

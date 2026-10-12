import type { Photo } from './catalogue.ts'
import type { RenamedPhoto } from './plan.ts'

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function imageMimeType(filename: string): string {
  if (filename.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (filename.endsWith('.png')) {
    return 'image/png'
  }
  return 'image/jpeg'
}

function photoTile(
  photo: Photo,
  label: string,
  imageBytes: Buffer,
  left: number,
  top: number,
): string {
  const mimeType = imageMimeType(photo.file)
  const imageData = `data:${mimeType};base64,${imageBytes.toString('base64')}`
  const labelLeft = left + 174
  const labelLines = label.match(/.{1,42}/g) ?? []
  const labelSpans = labelLines.map((line, lineIndex) => {
    const lineOffset = lineIndex === 0 ? 0 : 16
    return `<tspan x="${labelLeft}" dy="${lineOffset}">${escapeXml(line)}</tspan>`
  })

  return `
    <image x="${left}" y="${top}" width="160" height="100" href="${imageData}"/>
    <text x="${labelLeft}" y="${top + 20}" font-size="12">${labelSpans.join('')}</text>
    <text x="${labelLeft}" y="${top + 110}" font-size="12">${escapeXml(photo.date)}</text>`
}

export function createContactSheet(
  originalPhotos: Photo[],
  renamedPhotos: RenamedPhoto[],
  images: Map<string, Buffer>,
): string {
  const height = 100 + originalPhotos.length * 130
  const tiles: string[] = []

  for (let rowIndex = 0; rowIndex < originalPhotos.length; rowIndex++) {
    const originalPhoto = originalPhotos[rowIndex]!
    const renamedPhoto = renamedPhotos[rowIndex]!
    const top = 86 + rowIndex * 130

    tiles.push(photoTile(originalPhoto, originalPhoto.file, images.get(originalPhoto.id)!, 24, top))
    tiles.push(
      photoTile(renamedPhoto, renamedPhoto.destination, images.get(renamedPhoto.id)!, 560, top),
    )
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="${height}" viewBox="0 0 1100 ${height}">
  <rect width="1100" height="${height}" fill="#f8fafc"/>
  <g font-family="sans-serif" fill="#17253a">
    <text x="24" y="35" font-size="24">Photo box: before and after</text>
    <text x="24" y="66" font-size="16">Original order and names</text>
    <text x="560" y="66" font-size="16">Grouped copies · originals untouched</text>
    ${tiles.join('\n')}
  </g>
</svg>\n`
}

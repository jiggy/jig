import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { RenamedPhoto } from './assignments.ts'

/** Encode unavailable font characters visibly rather than silently dropping them. */
function printable(value: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet())
  return [...value]
    .map((character) =>
      supported.has(character.codePointAt(0)!)
        ? character
        : `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`,
    )
    .join('')
}
function lines(value: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = []
  let line = ''
  for (const character of printable(value, font)) {
    if (font.widthOfTextAtSize(line + character, size) > width && line) {
      result.push(line)
      line = ''
    }
    line += character
  }
  if (line) result.push(line)
  return result
}

export async function renderYearbook(
  title: string,
  photos: RenamedPhoto[],
  images: Map<string, Buffer>,
  signal: AbortSignal,
  coverId?: string,
): Promise<{ bytes: Uint8Array; pages: number }> {
  const document = await PDFDocument.create()
  document.setTitle(title)
  document.setSubject('A photo yearbook. Originals remain unchanged.')
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const groups = [...new Set(photos.map((photo) => photo.event))]
  const ink = rgb(0.12, 0.15, 0.19),
    muted = rgb(0.32, 0.37, 0.43)
  const photoTops = new Map<PDFPage, number>()
  const page = (heading: string, detail?: string) => {
    signal.throwIfAborted()
    const output = document.addPage([595.28, 841.89])
    output.drawRectangle({
      x: 0,
      y: 0,
      width: 595.28,
      height: 841.89,
      color: rgb(0.985, 0.985, 0.98),
    })
    const headingLines = lines(heading, bold, 24, 510)
    const detailLines = detail ? lines(detail, regular, 12, 510) : []
    const detailY = 772 - headingLines.length * 30 - 8
    photoTops.set(output, detailY - detailLines.length * 18 - 24)
    headingLines.forEach((line, index) =>
      output.drawText(line, { x: 42, y: 772 - index * 30, font: bold, size: 24, color: ink }),
    )
    if (detail)
      detailLines.forEach((line, index) =>
        output.drawText(line, {
          x: 42,
          y: detailY - index * 18,
          font: regular,
          size: 12,
          color: muted,
        }),
      )
    output.drawText(String(document.getPageCount()).padStart(2, '0'), {
      x: 42,
      y: 30,
      font: regular,
      size: 10,
      color: muted,
    })
    return output
  }
  const drawPhoto = async (output: ReturnType<typeof page>, photo: RenamedPhoto) => {
    signal.throwIfAborted()
    const source = images.get(photo.id)
    if (!source) throw new TypeError('Every yearbook photograph needs captured source bytes.')
    const image = photo.file.toLowerCase().endsWith('.png')
      ? await document.embedPng(source)
      : await document.embedJpg(source)
    const availableHeight = Math.max(40, Math.min(420, (photoTops.get(output) ?? 600) - 100))
    const scale = Math.min(510 / image.width, availableHeight / image.height)
    const width = image.width * scale,
      height = image.height * scale
    output.drawImage(image, {
      x: (595.28 - width) / 2,
      y: 100 + (availableHeight - height) / 2,
      width,
      height,
    })
    signal.throwIfAborted()
  }
  const cover = photos.find((photo) => photo.id === coverId) ?? photos[0]
  if (!cover) throw new TypeError('A yearbook needs at least one photograph.')
  await drawPhoto(page(title, 'A family yearbook'), cover)
  page('Contents', groups.map((group, index) => `${index + 1}. ${group}`).join('   /   '))
  for (const group of groups) {
    page(group, `${photos.filter((photo) => photo.event === group).length} photographs`)
    for (const photo of photos.filter((photo) => photo.event === group))
      await drawPhoto(page(photo.caption, photo.date), photo)
  }
  page(
    'The moments between them',
    'A collection to keep. Originals remain unchanged. Captions and event grouping should be reviewed before printing.',
  )
  const bytes = await document.save()
  signal.throwIfAborted()
  return { bytes, pages: document.getPageCount() }
}

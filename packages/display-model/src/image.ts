import type { DisplayImagePreview } from './types.js'

export const DISPLAY_IMAGE_BYTES = 2 * 1024 * 1024
/** Bounded inert raster data. This checks shape, not authenticity or decoding. */
export function validDisplayImage(value: unknown): value is DisplayImagePreview {
  if (!value || typeof value !== 'object') return false
  const image = value as DisplayImagePreview
  const shape =
    (image.mime === 'image/png' || image.mime === 'image/jpeg') &&
    Number.isSafeInteger(image.width) &&
    Number.isSafeInteger(image.height) &&
    image.width > 0 &&
    image.height > 0 &&
    image.width <= 4096 &&
    image.height <= 4096 &&
    image.width * image.height <= 4 * 1024 * 1024 &&
    typeof image.base64 === 'string' &&
    image.base64.length > 0 &&
    image.base64.length % 4 === 0 &&
    (image.base64.length / 4) * 3 -
      (image.base64.endsWith('==') ? 2 : image.base64.endsWith('=') ? 1 : 0) <=
      DISPLAY_IMAGE_BYTES &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)
  if (!shape) return false
  try {
    const raw = atob(image.base64)
    const byte = (offset: number) => raw.charCodeAt(offset)
    const u16 = (offset: number) => byte(offset) * 256 + byte(offset + 1)
    if (image.mime === 'image/png') {
      const u32 = (offset: number) => u16(offset) * 65536 + u16(offset + 2)
      return (
        raw.length >= 33 &&
        raw.slice(0, 8) === '\x89PNG\r\n\x1a\n' &&
        raw.slice(12, 16) === 'IHDR' &&
        u32(16) === image.width &&
        u32(20) === image.height
      )
    }
    if (byte(0) !== 255 || byte(1) !== 216) return false
    let offset = 2
    while (offset + 4 <= raw.length) {
      if (byte(offset++) !== 255) return false
      while (byte(offset) === 255) offset++
      const marker = byte(offset++)
      if (marker === 217 || marker === 218) return false
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      const size = u16(offset)
      if (size < 2 || offset + size > raw.length) return false
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        size >= 8
      )
        return u16(offset + 3) === image.height && u16(offset + 5) === image.width
      offset += size
    }
  } catch {}
  return false
}

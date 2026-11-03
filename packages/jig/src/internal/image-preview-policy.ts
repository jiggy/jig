import { type DisplayImagePreview, validDisplayImage } from '@jigging/display-model'

/** One closed profile for capture, renderer, transport and inspection retention. */
export const PRIVATE_PREVIEW_LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024,
  svgSourceBytes: 64 * 1024,
  textBytes: 4 * 1024,
  retainedBytes: 48 * 1024 * 1024,
  pngBytes: 2 * 1024 * 1024,
  svgPngBytes: 256 * 1024,
  svgRetainedBytes: 512 * 1024,
  svgWidth: 384,
  inputCacheBytes: 8 * 1024 * 1024,
  width: 1024,
  height: 1024,
  pixels: 1024 * 1024,
  wasmBytes: 5 * 1024 * 1024,
  rasterWasmBytes: 128 * 1024 * 1024,
  rasterPixels: 24_000_000,
  rasterDimension: 16384,
  rasterCopyBytes: 32 * 1024 * 1024,
  rasterDecodedTextBytes: 32 * 1024 * 1024,
  copyBytes: 1024 * 1024,
  decodedTextBytes: 1024 * 1024,
  renderMs: 5000,
  totalRenderMs: 10000,
})

/** Charge UTF-16 storage even when the runtime represents ASCII more cheaply. */
export function privatePreviewStringBytes(value: string): number {
  return 2 * value.length
}

/** Scan each prefix segment once, including malformed chains of XML comments. */
export function privateSvgDocumentStart(text: string): boolean {
  let offset = 0
  while (offset < text.length) {
    while (offset < text.length && /\s/.test(text[offset]!)) offset++
    if (text.startsWith('<!--', offset)) {
      const end = text.indexOf('-->', offset + 4)
      if (end < 0) return false
      offset = end + 3
    } else if (text.slice(offset, offset + 5).toLowerCase() === '<?xml') {
      const end = text.indexOf('>', offset + 5)
      if (end < 0) return false
      offset = end + 1
    } else {
      return /^<svg[\s>]/i.test(text.slice(offset, offset + 5))
    }
  }
  return false
}

export function privatePreviewDimensions(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= PRIVATE_PREVIEW_LIMITS.width &&
    height <= PRIVATE_PREVIEW_LIMITS.height &&
    width * height <= PRIVATE_PREVIEW_LIMITS.pixels
  )
}

/** The shared display shape is wider; file previews use the stricter owner profile. */
export function privateValidImagePreview(value: unknown): value is DisplayImagePreview {
  if (!value || typeof value !== 'object') return false
  const image = value as DisplayImagePreview
  if (
    image.mime !== 'image/png' ||
    !privatePreviewDimensions(image.width, image.height) ||
    typeof image.base64 !== 'string' ||
    image.base64.length > 4 * Math.ceil(PRIVATE_PREVIEW_LIMITS.pngBytes / 3)
  )
    return false
  return validDisplayImage(value)
}

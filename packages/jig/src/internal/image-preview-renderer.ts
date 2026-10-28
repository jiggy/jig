import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import wasmAsset from '@resvg/resvg-wasm/index_bg.wasm' with { type: 'file' }
import fontAsset from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf' with { type: 'file' }
import { privateGuardImageAllocations } from './image-preview-allocation.js'
import { PRIVATE_PREVIEW_LIMITS, privatePreviewDimensions } from './image-preview-policy.js'

function asset(value: string): Buffer {
  return value.startsWith('base64:') ? Buffer.from(value.slice(7), 'base64') : readFileSync(value)
}

const WASM_DIGEST = '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70'
const IMPORTS = [
  '__wbg_new_28c511d9baebfa89',
  '__wbindgen_memory',
  '__wbg_buffer_12d079cc21e14bdb',
  '__wbg_newwithbyteoffsetandlength_aa4a17c33a06e5cb',
  '__wbindgen_object_drop_ref',
  '__wbg_new_63b92bc8671ed464',
  '__wbg_values_839f3396d5aac002',
  '__wbg_next_196c84450b364254',
  '__wbg_done_298b57d23c0fc80c',
  '__wbg_value_d93c65011f51a456',
  '__wbg_instanceof_Uint8Array_2b3bbecd033d19f6',
  '__wbindgen_string_get',
  '__wbg_new_16b304a2cfa7ff4a',
  '__wbindgen_string_new',
  '__wbg_push_a5b05aedc7234f9f',
  '__wbg_length_c20a40f15020d68a',
  '__wbg_set_a47bac70306a19a7',
  '__wbindgen_throw',
].sort()

/** Only the pinned sole-memory module may enter this profile. No imported,
 * shared or additional memory or host callback can bypass its ceiling. */
function boundedModule(input: Buffer, raster: boolean): WebAssembly.Module {
  if (createHash('sha256').update(input).digest('hex') !== WASM_DIGEST)
    throw new Error('image module changed')
  let offset = 8
  const sections: Buffer[] = [input.subarray(0, 8)]
  let memories = 0
  function leb(): number {
    let value = 0
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = input[offset++]
      if (byte === undefined) throw new Error('invalid image module')
      value += (byte & 127) * 2 ** shift
      if (!(byte & 128)) return value
    }
    throw new Error('invalid image module')
  }
  while (offset < input.length) {
    const start = offset
    const id = input[offset++]
    if (id === undefined) throw new Error('invalid image module')
    const size = leb()
    const end = offset + size
    if (end > input.length) throw new Error('invalid image module')
    if (id === 5) {
      if (++memories !== 1 || leb() !== 1 || leb() !== 0 || leb() !== 23 || offset !== end)
        throw new Error('image memory changed')
      let pages =
        (raster ? PRIVATE_PREVIEW_LIMITS.rasterWasmBytes : PRIVATE_PREVIEW_LIMITS.wasmBytes) / 65536
      const maximum: number[] = []
      do {
        const low = pages & 127
        pages = Math.floor(pages / 128)
        maximum.push(low | (pages ? 128 : 0))
      } while (pages)
      sections.push(Buffer.from([5, 3 + maximum.length, 1, 1, 23, ...maximum]))
    } else sections.push(input.subarray(start, end))
    offset = end
  }
  if (memories !== 1) throw new Error('image memory missing')
  const module = new WebAssembly.Module(Buffer.concat(sections))
  const imports = WebAssembly.Module.imports(module)
  const names = imports.map((item) => item.name).sort()
  const memoryExports = WebAssembly.Module.exports(module).filter((item) => item.kind === 'memory')
  if (
    imports.some((item) => item.kind !== 'function' || item.module !== 'wbg') ||
    names.length !== IMPORTS.length ||
    names.some((name, index) => name !== IMPORTS[index]) ||
    memoryExports.length !== 1 ||
    memoryExports[0]?.name !== 'memory'
  )
    throw new Error('image imports changed')
  return module
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function rasterDimensions(
  bytes: Buffer,
): { mime: 'image/png' | 'image/jpeg'; width: number; height: number } | undefined {
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return { mime: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes[0] !== 255 || bytes[1] !== 216) return undefined
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return undefined
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === undefined) return undefined
    if (marker === 217 || marker === 218) return undefined
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue
    const size = bytes.readUInt16BE(offset)
    if (size < 2 || offset + size > bytes.length) return undefined
    if (
      [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
      size >= 8
    )
      return {
        mime: 'image/jpeg',
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      }
    offset += size
  }
  return undefined
}

interface SvgBudget {
  sourceBytes: number
  images: number
  rasterPixels: number
}
function inertSvg(text: string, depth: number, budget: SvgBudget): boolean {
  if (depth > 4 || /<!DOCTYPE|<!ENTITY/i.test(text)) return false
  for (const match of text.matchAll(/(?:\b|:)href\s*=\s*["']([^"']*)["']/gi)) {
    const href = match[1]
    if (href === undefined) return false
    if (href.startsWith('#') && !href.includes('&')) continue
    if (href.includes('&') || ++budget.images > 64) return false
    const data = /^data:(image\/(?:svg\+xml|png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/.exec(href)
    const payload = data?.[2]
    if (!data || payload === undefined) return false
    const size =
      (payload.length / 4) * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      budget.sourceBytes + size > PRIVATE_PREVIEW_LIMITS.svgSourceBytes
    )
      return false
    budget.sourceBytes += size
    const bytes = Buffer.from(payload, 'base64')
    if (bytes.length !== size) return false
    if (data[1] === 'image/svg+xml') {
      if (!inertSvg(new TextDecoder('utf-8', { fatal: true }).decode(bytes), depth + 1, budget))
        return false
    } else {
      const image = rasterDimensions(bytes)
      if (!image || image.mime !== data[1] || image.width < 1 || image.height < 1) return false
      budget.rasterPixels += image.width * image.height
      if (
        !Number.isSafeInteger(budget.rasterPixels) ||
        budget.rasterPixels > PRIVATE_PREVIEW_LIMITS.pixels
      )
        return false
    }
  }
  return true
}

/** Exactly one call per fresh decoder process; failed Wasm state is never reused. */
export async function privateRenderImage(
  bytes: Buffer,
  observe?: (allocations: { copies: number; decodedText: number }) => void,
): Promise<Buffer | undefined> {
  if (bytes.length > PRIVATE_PREVIEW_LIMITS.sourceBytes) return undefined
  const raster = rasterDimensions(bytes)
  if (!raster && bytes.length > PRIVATE_PREVIEW_LIMITS.svgSourceBytes) return undefined
  const module = boundedModule(asset(wasmAsset), !!raster)
  const font = asset(fontAsset)
  const allocations = privateGuardImageAllocations(!!raster)
  const { initWasm, Resvg } = await import('@resvg/resvg-wasm')
  await initWasm(module)
  let source: Uint8Array | string = bytes
  if (raster) {
    if (
      !Number.isSafeInteger(raster.width * raster.height) ||
      raster.width < 1 ||
      raster.height < 1 ||
      raster.width * raster.height > PRIVATE_PREVIEW_LIMITS.rasterPixels ||
      raster.width > PRIVATE_PREVIEW_LIMITS.rasterDimension ||
      raster.height > PRIVATE_PREVIEW_LIMITS.rasterDimension
    )
      return undefined
    // Native displays receive only host-rendered PNG, never an untrusted codec.
    source = `<svg xmlns="http://www.w3.org/2000/svg" width="${raster.width}" height="${raster.height}"><image width="100%" height="100%" href="data:${raster.mime};base64,${bytes.toString('base64')}"/></svg>`
  } else {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (
      !/^\s*(?:(?:<\?xml[^>]*>|<!--[\s\S]*?-->)\s*)*<svg[\s>]/i.test(text) ||
      !inertSvg(text, 0, { sourceBytes: bytes.length, images: 0, rasterPixels: 0 })
    )
      return undefined
  }
  // Fit tall and noisy inputs within the same inert-thumbnail profile.
  let width: number = PRIVATE_PREVIEW_LIMITS.width
  for (let attempt = 0; attempt < 4; attempt++) {
    const svg = new Resvg(source, {
      font: {
        fontBuffers: [font],
        defaultFontFamily: 'DejaVu Sans',
        sansSerifFamily: 'DejaVu Sans',
      },
      fitTo: { mode: 'width', value: width },
    })
    try {
      if (
        !Number.isFinite(svg.width) ||
        !Number.isFinite(svg.height) ||
        svg.width <= 0 ||
        svg.height <= 0
      )
        return undefined
      const height = Math.ceil((svg.height * width) / svg.width)
      if (!privatePreviewDimensions(width, height)) {
        width = Math.floor(Math.min(width - 1, (width * PRIVATE_PREVIEW_LIMITS.height) / height))
        if (width < 1) return undefined
        continue
      }
      const rendered = svg.render()
      try {
        if (!privatePreviewDimensions(rendered.width, rendered.height)) return undefined
        const png = rendered.asPng()
        if (png.byteLength <= PRIVATE_PREVIEW_LIMITS.pngBytes) {
          observe?.({ copies: allocations.copies(), decodedText: allocations.decodedText() })
          return Buffer.from(png)
        }
      } finally {
        rendered.free()
      }
    } finally {
      svg.free()
    }
    width = Math.max(1, Math.floor(width * 0.75))
  }
  return undefined
}

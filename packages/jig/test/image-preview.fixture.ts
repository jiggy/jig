import { fileURLToPath } from 'node:url'
const svg = (body: string, dimensions = 'width="32" height="16"') =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${dimensions}>${body}</svg>`)
const fixture = fileURLToPath(
  new URL('./fixtures/image-preview-lifetime-worker.ts', import.meta.url),
)
export { svg, fixture }

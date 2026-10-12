import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WebAssets } from '@jigging/display-model'

/** Build only this package's browser source into three self-contained fixed assets. */
export async function buildWebAssets(): Promise<WebAssets> {
  const root = resolve(import.meta.dir, '..')
  const result = await Bun.build({
    entrypoints: [resolve(root, 'src/app.ts')],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error('The browser inspector bundle could not be built')
  return Object.freeze({
    '/': Object.freeze({
      body: await readFile(resolve(root, 'src/index.html'), 'utf8'),
      contentType: 'text/html; charset=utf-8',
    }),
    '/assets/app.js': Object.freeze({
      body: await result.outputs[0]!.text(),
      contentType: 'text/javascript; charset=utf-8',
    }),
    '/assets/app.css': Object.freeze({
      body: await readFile(resolve(root, 'src/app.css'), 'utf8'),
      contentType: 'text/css; charset=utf-8',
    }),
  })
}

if (import.meta.main) {
  const assets = await buildWebAssets()
  const source = `const assets = ${JSON.stringify(assets)};\nfor (const asset of Object.values(assets)) Object.freeze(asset);\nexport const webAssets = Object.freeze(assets);\n`
  await Bun.write(resolve(import.meta.dir, '../dist/assets.js'), source)
}

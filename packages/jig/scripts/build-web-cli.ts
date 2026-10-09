import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PrivateWebAssets } from '../src/cli-web-assets.js'

/** Build fixed browser bytes, then embed them into the existing installed CLI. */
export async function privateBuildWebAssets(): Promise<PrivateWebAssets> {
  const root = resolve(import.meta.dir, '..')
  const result = await Bun.build({
    entrypoints: [resolve(root, 'src/web/app.ts')],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error('The browser inspector bundle could not be built')
  return Object.freeze({
    '/': Object.freeze({
      body: await readFile(resolve(root, 'src/web/index.html'), 'utf8'),
      contentType: 'text/html; charset=utf-8',
    }),
    '/assets/app.js': Object.freeze({
      body: await result.outputs[0]!.text(),
      contentType: 'text/javascript; charset=utf-8',
    }),
    '/assets/app.css': Object.freeze({
      body: await readFile(resolve(root, 'src/web/app.css'), 'utf8'),
      contentType: 'text/css; charset=utf-8',
    }),
  })
}

export async function privateBuildWebCli(): Promise<void> {
  const root = resolve(import.meta.dir, '..')
  const assets = await privateBuildWebAssets()
  const assetModule = resolve(root, 'src/cli-web-assets.ts')
  const result = await Bun.build({
    entrypoints: [resolve(root, 'src/installed-cli.ts')],
    target: 'bun',
    format: 'esm',
    external: ['@opentui/core'],
    sourcemap: 'none',
    plugins: [
      {
        name: 'jig-fixed-browser-assets',
        setup(build) {
          build.onLoad({ filter: /cli-web-assets\.ts$/ }, (args) =>
            resolve(args.path) === assetModule
              ? {
                  loader: 'ts',
                  contents: `export const privateWebAssets = Object.freeze(${JSON.stringify(assets)});`,
                }
              : undefined,
          )
        },
      },
    ],
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error('The installed CLI with embedded browser assets could not be built')
  await Bun.write(resolve(root, 'libexec/installed-cli.js'), result.outputs[0]!)
}

if (import.meta.main) await privateBuildWebCli()

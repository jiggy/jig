import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_ASSETS = [
  ['@resvg/resvg-wasm', '10170d02d816f02ec76f9bc095b01d9becf536e7b1e12e5aa616652c84b237a1'],
  [
    '@resvg/resvg-wasm/index_bg.wasm',
    '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70',
  ],
] as const

async function skillFiles(
  directory: string,
  prefix: string,
): Promise<readonly (readonly [string, string])[]> {
  const files: (readonly [string, string])[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name === '.tmp' || entry.name === 'node_modules') continue
    const path = join(directory, entry.name)
    const target = `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await skillFiles(path, target)))
    else if (entry.isFile()) files.push([target, await readFile(path, 'utf8')])
    else throw Error(`An authoring skill input is not a regular file: ${target}`)
  }
  return files
}

/** Resolve declared renderer exports and embed their built bytes in CLI identity. */
export async function privateBuildCli(): Promise<void> {
  const root = resolve(import.meta.dir, '..')
  for (const [specifier, expected] of IMAGE_ASSETS) {
    const bytes = await readFile(fileURLToPath(import.meta.resolve(specifier)))
    if (createHash('sha256').update(bytes).digest('hex') !== expected)
      throw new Error(`The audited image asset changed: ${specifier}`)
  }
  const worker = await build('src/image-preview-worker.ts')
  const digest = `sha256:${createHash('sha256')
    .update(new Uint8Array(await worker.arrayBuffer()))
    .digest('hex')}`
  await Bun.write(resolve(root, 'libexec/image-preview-worker.js'), worker)
  const command = await build('src/installed-cli.ts', {
    __JIG_IMAGE_PREVIEW_WORKER_DIGEST__: JSON.stringify(digest),
  })
  await Bun.write(resolve(root, 'libexec/installed-cli.js'), command)
  const [jig, flow] = await Promise.all([
    skillFiles(resolve(root, '../../skills/jig'), 'jig'),
    skillFiles(resolve(root, 'support/flow-skill'), 'flow'),
  ])
  await Bun.write(resolve(root, 'libexec/init-skills.json'), JSON.stringify([...jig, ...flow]))
  const parserNotices = new URL(
    '../ThirdPartyNoticeText.txt',
    import.meta.resolve('typescript-parser'),
  )
  await Bun.write(
    resolve(root, 'libexec/flow-behavior.typescript-notices.txt'),
    await readFile(parserNotices),
  )

  async function build(entrypoint: string, define: Record<string, string> = {}): Promise<Blob> {
    const result = await Bun.build({
      entrypoints: [resolve(root, entrypoint)],
      define,
      target: 'bun',
      format: 'esm',
      external: ['@opentui/core', 'web-tree-sitter'],
      sourcemap: 'none',
      plugins: [
        {
          name: 'captured-image-assets',
          setup(build) {
            build.onLoad({ filter: /\.(wasm|ttf)$/ }, async ({ path }) => ({
              loader: 'js',
              contents: `export default ${JSON.stringify(`base64:${(await readFile(path)).toString('base64')}`)}`,
            }))
          },
        },
      ],
    })
    const output = result.outputs[0]
    if (!result.success || result.outputs.length !== 1 || output === undefined)
      throw new Error(`The installed ${entrypoint} bundle could not be built`)
    return output
  }
}

if (import.meta.main) await privateBuildCli()

import { resolve } from 'node:path'

/** Resolve declared renderer exports and embed their built bytes in CLI identity. */
export async function privateBuildCli(): Promise<void> {
  const root = resolve(import.meta.dir, '..')
  const result = await Bun.build({
    entrypoints: [resolve(root, 'src/installed-cli.ts')],
    target: 'bun',
    format: 'esm',
    external: ['@opentui/core', 'web-tree-sitter'],
    sourcemap: 'none',
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error('The installed CLI with embedded browser assets could not be built')
  await Bun.write(resolve(root, 'libexec/installed-cli.js'), result.outputs[0]!)
}

if (import.meta.main) await privateBuildCli()

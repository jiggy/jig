#!/usr/bin/env node
/** Reproduce the source-qualified Sley experiment without package downloads. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { resolve, join } from 'node:path'

// Git blob identities from jiggy/sley commit dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a.
const SOURCES = {
  'sley.ts': 'ebc55c7ccdb4f181d3764e99b91542939643f213',
  'context.ts': 'edc97c2a5bd06613a4a3bf73c398a29ff5b1819a',
  'contracts.ts': '7fb7fd3eecb45aaa16d33fc4f46839e99fdbda32',
  'graph.ts': '224cf37d3870cf318f0b90246dab664b7c175f1d',
  'runner.ts': 'deca5fd649e5eca4b41970463accdb3f4801e0ea',
  'state.ts': '81c9b4ab96ea70883dbcc42a8e61561572900433',
  'package.json': '3983c6eaa99cb47e960db889d531fb5d7f1e007b',
}

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error('Usage: node sley-source-probe.mjs SLEY_CHECKOUT NEW_OUTPUT_DIRECTORY')
  process.exit(2)
}

try {
  const sourceRoot = resolve(args[0]), destination = resolve(args[1])
  const verified = new Map()
  for (const [name, sha] of Object.entries(SOURCES)) {
    const bytes = await readFile(join(sourceRoot, 'typescript', name))
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    if (actual !== sha) throw new Error('Source differs from the pinned Sley experiment.')
    verified.set(name, bytes.toString('utf8'))
  }
  // The output must not replace an existing experiment or a source checkout.
  await mkdir(destination, { recursive: false })
  const consumer = join(destination, 'consumer')
  const packageRoot = join(consumer, 'node_modules', '@jigging', 'sley')
  await mkdir(join(packageRoot, 'dist'), { recursive: true })
  await writeFile(join(packageRoot, 'package.json'), verified.get('package.json'))
  for (const [name, source] of verified) {
    if (!name.endsWith('.ts')) continue
    const output = stripTypeScriptTypes(source, { mode: 'strip' })
    await writeFile(join(packageRoot, 'dist', name.replace(/\.ts$/, '.js')), output)
  }
  const probe = join(consumer, 'probe.mjs')
  await copyFile(new URL('./sley-probe.mjs', import.meta.url), probe)
  const execution = spawnSync(process.execPath, [probe, join(destination, 'evidence')], { encoding: 'utf8', timeout: 30_000 })
  if (execution.stdout) process.stdout.write(execution.stdout)
  if (execution.stderr) process.stderr.write(execution.stderr)
  if (execution.error || execution.status !== 0) throw new Error('The Sley probe did not complete successfully.')
  await writeFile(join(destination, 'source-evidence.json'), JSON.stringify({
    repository: 'https://github.com/jiggy/sley',
    commit: 'dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a',
    version: '0.0.3', node: process.version,
    qualification: 'Verified source blobs and public ESM exports. No published npm artifact was qualified.',
    files: SOURCES,
  }, null, 2) + '\n')
} catch (error) {
  console.error(error?.code === 'EEXIST' ? 'The output directory already exists. Choose a new directory.'
    : error?.code === 'ENOENT' ? 'The source checkout or output parent directory is unavailable.'
    : error.message)
  process.exitCode = 1
}

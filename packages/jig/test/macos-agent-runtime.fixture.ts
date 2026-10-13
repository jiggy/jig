import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeMachO } from './fixtures/native-macho.js'

const roots = new Set<string>()
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-macho-')))
  roots.add(root)
  const project = join(root, 'project'),
    executable = join(root, 'client')
  await mkdir(project)
  return { root, project, executable }
}
async function binary(path: string, options: Parameters<typeof nativeMachO>[0] = {}) {
  await writeFile(path, nativeMachO(options), { mode: 0o700 })
}

export { binary, fixture, roots }

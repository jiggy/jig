import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Identify this executable's own contributor checkout, independently of cwd. */
export async function privateJigDevelopmentCheckout(release: string): Promise<string | undefined> {
  try {
    const installed = await realpath(release)
    const root = dirname(dirname(installed))
    if (installed !== join(root, 'packages', 'jig')) return
    for (const path of [
      'justfile',
      'packages/jig/src/installed-cli.ts',
      'packages/jig/scripts/installed-jig.sh',
    ]) {
      if (!(await lstat(join(root, path))).isFile()) return
    }
    const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
    if (workspace.name === 'jig-workspace' && manifest.name === '@jigging/jig') return root
  } catch {
    // An ordinary installed package has no contributor source or workspace.
  }
}

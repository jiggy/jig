import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-input-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

export { fixture }

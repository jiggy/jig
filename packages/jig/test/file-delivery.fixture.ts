import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-file-delivery-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const record = { status: 'succeeded', outcome: 'blocked', output: { reason: 'synthetic evidence' } }
async function fixturePid(path: string): Promise<number> {
  const pid = Number(await readFile(path, 'utf8'))
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid owned fixture PID')
  return pid
}
async function waitUntilStopped(pid: number): Promise<void> {
  const deadline = performance.now() + 1500
  while (performance.now() < deadline) {
    if (process.platform === 'darwin') {
      const result = spawnSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], {
        encoding: 'utf8',
        timeout: 1000,
      })
      if (result.status === 0 && result.stdout.trim().startsWith('T')) return
    } else if (/^State:\s+T/m.test(await readFile(`/proc/${pid}/status`, 'utf8'))) return
    await Bun.sleep(5)
  }
  throw new Error('owned fixture did not stop')
}

export { fixture, fixturePid, record, waitUntilStopped }

import { test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foundationCommands,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { runInstalledAttemptExport } from '../fixtures/installed-attempt-export.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('frozen installed exports reconcile written evidence and preserve real failed/cancelled checkpoints', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-export-')))
  let completed = false
  try {
    const archives = await freezeFoundationArchives(
      root,
      foundationCommands(join(root, 'archive-commands')),
    )
    await runInstalledAttemptExport(join(root, 'consumer'), archives, qualification)
    completed = true
  } finally {
    if (completed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed export consumer and private transcripts retained at ${root}`)
  }
}, 900_000)

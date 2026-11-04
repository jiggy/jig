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
import { runInstalledChildCheckpoints } from '../fixtures/installed-child-checkpoints.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed nested routers repair failed and unsuccessful children from isolated retained checkpoints', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-child-checkpoints-')))
  let completed = false
  try {
    const archives = await freezeFoundationArchives(
      root,
      foundationCommands(join(root, 'archive-commands')),
    )
    await runInstalledChildCheckpoints(join(root, 'consumer'), archives, qualification)
    completed = true
  } finally {
    if (completed) await rm(root, { recursive: true, force: true })
    else console.error(`Installed child checkpoint consumer and private transcripts retained at ${root}`)
  }
}, 900_000)

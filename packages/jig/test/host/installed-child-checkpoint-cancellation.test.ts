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
import { runInstalledChildCheckpointCancellation } from '../fixtures/installed-child-checkpoint-cancellation.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed child checkpoint retrieval waits for local cancellation and native cleanup', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-child-checkpoint-cancellation-')))
  let completed = false
  try {
    const archives = await freezeFoundationArchives(
      root,
      foundationCommands(join(root, 'archive-commands')),
    )
    await runInstalledChildCheckpointCancellation(join(root, 'consumer'), archives, qualification)
    completed = true
  } finally {
    if (completed) await rm(root, { recursive: true, force: true })
    else console.error(`Child checkpoint cancellation consumer and private transcripts retained at ${root}`)
  }
}, 900_000)

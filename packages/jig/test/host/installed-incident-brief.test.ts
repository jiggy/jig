import { test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foundationCommands,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import {
  freezeIncidentLibraries,
  runInstalledIncident,
} from '../fixtures/installed-incident-brief.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

for (const scenario of ['replacement', 'commentary', 'budget', 'refused-successor'] as const) {
  test(`installed incident brief: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-installed-incident-'))
    let passed = false
    try {
      const command = foundationCommands(join(root, 'archive-commands'))
      const archives = await freezeFoundationArchives(root, command)
      const libraries = await freezeIncidentLibraries(root, command)
      await runInstalledIncident({
        directory: join(root, 'consumer'),
        archives,
        libraries,
        qualification,
        scenario,
      })
      passed = true
    } finally {
      if (passed) await rm(root, { recursive: true, force: true })
      else console.error(`Incident consumer and bounded transcripts retained at ${root}`)
    }
  }, 600_000)
}

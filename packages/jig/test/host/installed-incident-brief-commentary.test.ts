import { test } from 'bun:test'
import {
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { runInstalledIncidentScenario } from '../fixtures/installed-incident-brief.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed incident brief: commentary', async () => {
  await runInstalledIncidentScenario('commentary', qualification)
}, 600_000)

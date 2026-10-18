import { afterAll, beforeAll, describe, test } from 'bun:test'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type FoundationArchives,
  foundationCommands,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
  runInstalledFoundationApplication,
} from '../fixtures/host-foundation/materialize.js'

// Whole-file admission: never skip/filter or replace native qualification with mocks.
requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

describe.serial('maintainer-owned installed host foundation (not unfamiliar usability)', () => {
  let root: string | undefined
  let archives: FoundationArchives
  let completed = 0
  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-foundation-')))
    archives = await freezeFoundationArchives(
      root,
      foundationCommands(join(root, 'archive-commands')),
    )
  }, 300_000)
  for (const application of ['adaptive', 'documents'] as const) {
    const behavior =
      application === 'adaptive'
        ? 'real nonzero evaluation stops later phases, then immutable accepted artifacts'
        : 'immutable duplicate child handoff, cancellation and client death without replay'
    test(`frozen public artifacts: independent ${application} application; ${behavior}`, async () => {
      await runInstalledFoundationApplication({
        directory: join(root!, application),
        application,
        archives,
        qualification,
      })
      completed++
    }, 900_000)
  }
  afterAll(async () => {
    if (!root) return
    if (completed === 2) await rm(root, { recursive: true, force: true })
    else
      console.error(
        `Installed foundation failed consumers and private transcripts retained at ${root}`,
      )
  })
})

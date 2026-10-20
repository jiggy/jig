import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  foundationCommands,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'
import { runInstalledKitchenProject } from '../fixtures/installed-kitchen-roster.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('installed kitchen roster delivers a checked CSV and stops uncovered input', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-kitchen-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'archive-commands'))
    const archives = await freezeFoundationArchives(root, command)
    const reportingRoot = resolve(import.meta.dir, '../../../reporting')
    let reporting = process.env.REPORTING_PACKAGE_ARCHIVE
    if (!reporting) {
      const destination = join(root, 'reporting-pack')
      await mkdir(destination)
      await command(
        [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        reportingRoot,
        120_000,
      )
      const manifest = JSON.parse(await readFile(join(reportingRoot, 'package.json'), 'utf8'))
      reporting = join(destination, `jigging-reporting-${manifest.version}.tgz`)
    }
    const frozenReporting = join(root, 'archives/reporting.tgz')
    await copyFile(reporting, frozenReporting)
    assert.deepEqual(await readFile(frozenReporting), await readFile(reporting))
    await runInstalledKitchenProject({
      directory: join(root, 'consumer'),
      archives,
      reporting: frozenReporting,
      qualification,
    })
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Kitchen consumer and bounded transcripts retained at ${root}`)
  }
}, 600_000)

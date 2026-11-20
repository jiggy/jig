import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foundationCommands,
  foundationResidue,
  freezeFoundationArchives,
  qualifyFoundationHost,
} from '../fixtures/host-foundation/materialize.js'

const qualification = await qualifyFoundationHost()

test('installed public consumer isolates an offer edit to its producer Binding', async () => {
  const keep = process.env.JIG_WIRING_EVIDENCE_DIRECTORY
  const root = await mkdtemp(join(await realpath(keep ?? tmpdir()), 'jig-installed-wiring-'))
  const command = foundationCommands(join(root, 'commands'))
  let passed = false
  try {
    const before = await foundationResidue(qualification, command, root)
    const archives = await freezeFoundationArchives(root, command)
    const consumer = join(root, 'consumer')
    await cp(join(import.meta.dir, '../fixtures/shared-binding-wiring'), consumer, {
      recursive: true,
    })
    await command(
      [
        process.execPath,
        'add',
        '--dev',
        '--ignore-scripts',
        '--no-progress',
        '--backend',
        'copyfile',
        archives.jig,
      ],
      consumer,
      120_000,
    )
    const node = process.env.FLOW_NODE ?? Bun.which('node')
    assert.ok(node, 'The shared Binding consumer requires Node')
    await command(
      ['env', `JIG_WIRING_EVIDENCE_DIRECTORY=${root}`, node, '--test', 'wiring.mjs'],
      consumer,
      720_000,
    )
    const after = await foundationResidue(qualification, command, root)
    await writeFile(join(root, 'residue.json'), JSON.stringify({ before, after }), { mode: 0o600 })
    assert.deepEqual(after, before)
    passed = true
  } finally {
    if (passed && !keep) await rm(root, { recursive: true, force: true })
    else console.error(`Installed wiring consumer and command transcripts retained at ${root}`)
  }
}, 900_000)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { promoteDirectory } from '../promote-directory.mjs'

async function fixture(scenario) {
  const root = await mkdtemp(join(tmpdir(), 'directory-promotion-'))
  const staging = join(root, 'staging')
  const output = join(root, 'output')
  try {
    await mkdir(staging)
    await writeFile(join(staging, 'candidate'), 'exact bytes')
    await scenario({ root, staging, output })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('promotion publishes the exact staging inode and complete bytes', async () => {
  await fixture(async ({ staging, output }) => {
    const before = await lstat(staging, { bigint: true })
    await promoteDirectory(staging, output)
    const after = await lstat(output, { bigint: true })
    assert.equal(after.ino, before.ino)
    assert.equal(after.dev, before.dev)
    assert.equal(await readFile(join(output, 'candidate'), 'utf8'), 'exact bytes')
    await assert.rejects(lstat(staging), { code: 'ENOENT' })
  })
})

test('existing directories, files and dangling symlinks are preserved', async () => {
  for (const kind of ['directory', 'file', 'symlink']) {
    await fixture(async ({ root, staging, output }) => {
      if (kind === 'directory') await mkdir(output)
      else if (kind === 'file') await writeFile(output, 'existing bytes')
      else await symlink(join(root, 'missing'), output)
      const before = await lstat(output, { bigint: true })
      await assert.rejects(promoteDirectory(staging, output), /output already exists/)
      assert.equal((await lstat(output, { bigint: true })).ino, before.ino)
      assert.equal(await readFile(join(staging, 'candidate'), 'utf8'), 'exact bytes')
      if (kind === 'directory') assert.deepEqual(await readdir(output), [])
      if (kind === 'file') assert.equal(await readFile(output, 'utf8'), 'existing bytes')
    })
  }
})

test('a racing destination cannot qualify or retain a nested staging tree', async () => {
  await fixture(async ({ root, staging, output }) => {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const wrapper = join(bin, 'mv')
    // Force creation after the helper's precheck, then run the real platform mv.
    await writeFile(
      wrapper,
      `#!${process.execPath}
const fs = require('node:fs');
const child = require('node:child_process');
const args = process.argv.slice(2);
const output = args[args.length - 1];
fs.mkdirSync(output);
fs.writeFileSync(output + '/existing', 'existing bytes');
const result = child.spawnSync('/bin/mv', args, {stdio:'inherit'});
process.exit(result.status);
`,
    )
    await chmod(wrapper, 0o755)
    const result = spawnSync(
      process.execPath,
      [resolve(import.meta.dirname, '../promote-directory.mjs'), staging, output],
      { env: { PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8' },
    )
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /output appeared during directory promotion/)
    assert.deepEqual(await readdir(output), ['existing'])
    assert.equal(await readFile(join(output, 'existing'), 'utf8'), 'existing bytes')
  })
})

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { access, link, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateMacosOwner } from '../src/internal/macos-owner-state.js'
import {
  privateMacosOwnerIsFromPriorBoot,
  recoverPrivateMacosCoalition,
} from '../src/internal/macos-process-controls.js'
import { runMacosFixture } from './fixtures/macos-launchd.js'
async function terminalJoinFailureFixture(directory: string): Promise<string> {
  const sourceUrl = new URL('./fixtures/macos-exec-owner.ts', import.meta.url)
  const source = await readFile(sourceUrl, 'utf8')
  const point = 'Promise.all([exited, framesEnded]),'
  expect(source.split(point)).toHaveLength(2)
  const fixture = join(directory, 'held-terminal.ts')
  await writeFile(
    fixture,
    source
      .replace(point, 'Promise.all([exited, new Promise<void>(() => {})]),')
      .replaceAll(
        "from '../../src/internal/",
        `from '${fileURLToPath(new URL('../src/internal/', import.meta.url))}`,
      ),
  )
  return fixture
}
export { terminalJoinFailureFixture }

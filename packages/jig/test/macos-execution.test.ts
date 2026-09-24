import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMacosFixture } from './fixtures/macos-launchd.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)
native(
  'native launcher holds admission, closes handoffs and applies isolation before executing',
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-exec-build-')))
    const launcher = join(directory, 'macos-exec')
    const payload = join(directory, 'payload')
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-exec-payload.c', import.meta.url), payload],
      ] as const) {
        const build = spawnSync(
          '/usr/bin/clang',
          [
            '-O2',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wno-deprecated-declarations',
            fileURLToPath(source),
            '-o',
            output,
          ],
          { encoding: 'utf8', timeout: 15_000 },
        )
        expect({ status: build.status, errors: build.stderr }).toEqual({ status: 0, errors: '' })
      }
      await runMacosFixture(
        fileURLToPath(new URL('./fixtures/macos-exec-owner.ts', import.meta.url)),
        [launcher, payload],
        { empty: true, passed: true },
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  40_000,
)

native(
  'native scopes supervise resources, deadlines, cancellation and orphan cleanup',
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-scope-build-')))
    const launcher = join(directory, 'macos-exec'),
      payload = join(directory, 'payload')
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-scope-payload.c', import.meta.url), payload],
      ] as const) {
        const build = spawnSync(
          '/usr/bin/clang',
          [
            '-O2',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wno-deprecated-declarations',
            fileURLToPath(source),
            '-o',
            output,
          ],
          { encoding: 'utf8', timeout: 15_000 },
        )
        expect({ status: build.status, errors: build.stderr }).toEqual({ status: 0, errors: '' })
      }
      await runMacosFixture(
        fileURLToPath(new URL('./fixtures/macos-scope-owner.ts', import.meta.url)),
        [launcher, payload],
        { empty: true, passed: true, completed: 9 },
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  40_000,
)

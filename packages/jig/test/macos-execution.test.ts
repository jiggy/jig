import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { access, link, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateMacosOwner } from '../src/internal/macos-owner-state.js'
import { recoverPrivateMacosCoalition } from '../src/internal/macos-process-controls.js'
import { runMacosFixture } from './fixtures/macos-launchd.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'fresh recovery authenticates durable ownership and fences descendants after guardian loss',
  async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-recovery-build-')))
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'jig-macos-recovery-data-')))
    let recoveredFixture = false
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
        fileURLToPath(new URL('./fixtures/macos-recovery-owner.ts', import.meta.url)),
        [launcher, payload, scratch],
        { empty: true, passed: true },
        async (state) => {
          const end = performance.now() + 12_000
          while (
            !(await access(`${state}/ready`).then(
              () => true,
              () => false,
            )) &&
            performance.now() < end
          )
            await Bun.sleep(10)
          await access(`${state}/ready`)
          const journal = `${state}/owner.json`
          const original = await readFile(journal)
          let failure: unknown
          try {
            const owner = readPrivateMacosOwner(state, 'a'.repeat(64))
            await expect(
              recoverPrivateMacosCoalition({ identity: owner.identity }, 3000),
            ).rejects.toThrow('not authentic')
            await expect(recoverPrivateMacosCoalition(owner, 3000)).rejects.toThrow('still alive')
            expect(() => readPrivateMacosOwner(state, 'b'.repeat(64))).toThrow(
              'authentication failed',
            )
            await link(journal, `${state}/alias`)
            expect(() => readPrivateMacosOwner(state, 'a'.repeat(64))).toThrow('unsafe')
            await unlink(`${state}/alias`)
            const record = JSON.parse(original.toString())
            record.identity.bootId = '00000000-0000-0000-0000-000000000000'
            await writeFile(journal, JSON.stringify(record))
            expect(() => readPrivateMacosOwner(state, 'a'.repeat(64))).toThrow(
              'authentication failed',
            )
            record.mac = createHmac('sha256', Buffer.from('a'.repeat(64), 'hex'))
              .update('jig-macos-owner\0')
              .update(JSON.stringify(record.identity))
              .digest('hex')
            await writeFile(journal, JSON.stringify(record))
            await expect(
              recoverPrivateMacosCoalition(readPrivateMacosOwner(state, 'a'.repeat(64)), 3000),
            ).rejects.toThrow('boot does not match')
          } catch (error) {
            failure = error
          } finally {
            await unlink(`${state}/alias`).catch(() => undefined)
            await writeFile(journal, original)
            await writeFile(`${state}/lose-guardian`, 'stop\n', { mode: 0o600 })
            const recovered = spawnSync(
              process.execPath,
              [
                '--no-env-file',
                '--no-install',
                '--config=/dev/null',
                fileURLToPath(new URL('./fixtures/macos-recover.ts', import.meta.url)),
                state,
              ],
              { env: {}, encoding: 'utf8', timeout: 6000 },
            )
            expect({
              status: recovered.status,
              errors: recovered.stderr,
              text: recovered.stdout,
            }).toEqual({ status: 0, errors: '', text: '{"empty":true,"passed":true}\n' })
            recoveredFixture = true
            await writeFile(`${state}/out`, recovered.stdout)
          }
          if (failure !== undefined) throw failure
        },
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
      if (recoveredFixture) await rm(scratch, { recursive: true, force: true })
      else console.error(`Unconfirmed recovery scratch retained at ${scratch}`)
    }
  },
  40_000,
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
  75_000,
)

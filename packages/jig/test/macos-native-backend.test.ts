import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrivateCapturedOutput } from '../src/internal/captured-output.js'
import {
  closePrivateExecutionOutput,
  resolvePrivateExecutionOutput,
} from '../src/internal/execution-output.js'
import {
  openPrivateMacosBackendState,
  planPrivateMacosOwnerStateAllocation,
  releasePrivateMacosOwnerState,
} from '../src/internal/macos-backend-state.js'
import {
  PrivateMacosBackend,
  type PrivateMacosLaunchPlan,
} from '../src/internal/macos-native-backend.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'native backend seals, admits, retains output, persists fencing and releases exact ownership',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-native-backend-')
    const owners = join(root, 'owners')
    await mkdir(owners, { mode: 0o700 })
    const launcher = join(root, 'macos-exec')
    const payload = join(root, 'payload')
    let safeToRemove = false
    try {
      for (const [source, output] of [
        [new URL('../support/macos-exec.c', import.meta.url), launcher],
        [new URL('./fixtures/macos-storage-payload.c', import.meta.url), payload],
      ] as const) {
        const compiled = spawnSync(
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
        expect({ status: compiled.status, stderr: compiled.stderr }).toEqual({
          status: 0,
          stderr: '',
        })
      }
      const backend = new PrivateMacosBackend({
        bunPath: process.execPath,
        supervisorPath: fileURLToPath(
          new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
        ),
        launcherPath: launcher,
      })
      const support = await backend.inspectSupport()
      expect(support.resourceOvershoot).toBe(true)
      const allocation = await planPrivateMacosOwnerStateAllocation({
        parent: owners,
        name: 'successful',
      })
      const data = join(allocation.directory, 'data')
      const plan: PrivateMacosLaunchPlan = {
        runId: 'successful',
        limits: {
          memoryBytes: 32 * 1024 * 1024,
          pids: 4,
          cpuQuotaMicros: 50_000,
          cpuPeriodMicros: 100_000,
          deadlineUnixMs: Date.now() + 30_000,
          cleanupTimeoutMs: 5000,
        },
        command: [
          payload,
          'complete',
          join(data, 'output/result.txt'),
          join(allocation.directory, 'control/guardian/storage/volume.dmg'),
        ],
        cwd: join(data, 'work'),
        environment: {},
        files: {
          readOnlyFiles: [payload],
          readOnlyTrees: [],
          writableTrees: ['work', 'tmp', 'output'].map((name) => join(data, name)),
          protectedRoots: [join(allocation.directory, 'control')],
          network: 'isolated',
        },
        maxOutputBytes: 4096,
        storage: { mountPath: data, bytes: 16 * 1024 * 1024, collect: 'output' },
      }
      const sealed = await backend.seal(plan, allocation)
      const observed = await openPrivateMacosBackendState(allocation)
      try {
        expect((await observed.read()).sealed).toEqual(sealed.identity)
      } finally {
        await observed.close()
      }
      let prepared = ''
      const component = await sealed.admit(undefined, async (owner) => {
        prepared = owner.digest
      })
      component.stdout[Symbol.asyncIterator]()
      component.stderr[Symbol.asyncIterator]()
      await component.closeInput()
      const [exit, receipt] = await Promise.all([component.completion, component.enforcement])
      expect(prepared).toBe(component.owner.digest)
      expect(exit).toMatchObject({ exitCode: 0, fenced: true, stopReason: 'payload_exit' })
      expect(receipt.recovered).toBe(false)
      expect(receipt.evidence.samples).toBeGreaterThan(0)
      const output = await resolvePrivateExecutionOutput(component.output)
      const files = readPrivateCapturedOutput(output as never)
      expect(files.map((file) => [file.path, file.contents.toString()])).toEqual([
        ['result.txt', 'captured-output'],
      ])
      await closePrivateExecutionOutput(component.output)
      expect(
        await access(data).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
      expect((await backend.recoverFence(sealed.identity)).ownerDigest).toBe(receipt.ownerDigest)
      await releasePrivateMacosOwnerState(allocation, receipt as never)
      expect(await readdir(owners)).toEqual([])

      const unused = await planPrivateMacosOwnerStateAllocation({ parent: owners, name: 'unused' })
      const unusedData = join(unused.directory, 'data')
      const unusedPlan: PrivateMacosLaunchPlan = {
        ...plan,
        runId: 'unused',
        cwd: join(unusedData, 'work'),
        command: [
          payload,
          'complete',
          join(unusedData, 'output/result.txt'),
          join(unused.directory, 'control/guardian/storage/volume.dmg'),
        ],
        files: {
          ...plan.files,
          writableTrees: ['work', 'tmp', 'output'].map((name) => join(unusedData, name)),
          protectedRoots: [join(unused.directory, 'control')],
        },
        storage: { ...plan.storage!, mountPath: unusedData },
      }
      const unusedOwner = await backend.seal(unusedPlan, unused)
      const recovered = await backend.recoverFence(unusedOwner.identity)
      expect(recovered).toMatchObject({ stopReason: 'recovered', recovered: true, fenced: true })
      await releasePrivateMacosOwnerState(unused, recovered as never)
      expect(await readdir(owners)).toEqual([])

      for (const [index, mode] of ['prepared', 'active'].entries()) {
        const name = `loss-${mode}`
        const lost = await planPrivateMacosOwnerStateAllocation({ parent: owners, name })
        const lostData = join(lost.directory, 'data')
        const identityPath = join(root, `identity-${index}.json`)
        const lostPlan: PrivateMacosLaunchPlan = {
          ...plan,
          runId: name,
          cwd: join(lostData, 'work'),
          command: [
            payload,
            'waiting',
            join(lostData, 'output/result.txt'),
            join(lost.directory, 'control/guardian/storage/volume.dmg'),
          ],
          files: {
            ...plan.files,
            writableTrees: ['work', 'tmp', 'output'].map((part) => join(lostData, part)),
            protectedRoots: [join(lost.directory, 'control')],
          },
          storage: { ...plan.storage!, mountPath: lostData },
        }
        const fixturePath = join(root, `loss-${index}.json`)
        await writeFile(
          fixturePath,
          JSON.stringify({
            mode,
            identityPath,
            options: {
              bunPath: process.execPath,
              supervisorPath: fileURLToPath(
                new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
              ),
              launcherPath: launcher,
            },
            allocation: lost,
            plan: lostPlan,
          }),
          { mode: 0o600, flag: 'wx' },
        )
        const child = spawnSync(
          process.execPath,
          [
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            fileURLToPath(new URL('./fixtures/macos-native-backend-loss.ts', import.meta.url)),
            fixturePath,
          ],
          { env: {}, encoding: 'utf8', timeout: 20_000 },
        )
        expect({ status: child.status, stdout: child.stdout, stderr: child.stderr }).toEqual({
          status: mode === 'prepared' ? 76 : 77,
          stdout: '',
          stderr: '',
        })
        const identity = JSON.parse(await readFile(identityPath, 'utf8'))
        const lostReceipt = await backend.recoverFence(identity)
        expect(lostReceipt).toMatchObject({
          stopReason: 'recovered',
          recovered: true,
          fenced: true,
        })
        await releasePrivateMacosOwnerState(lost, lostReceipt as never)
        expect(await readdir(owners)).toEqual([])
      }

      const automatic = await backend.launch((allocation) => {
        const data = join(allocation.directory, 'data')
        const work = join(data, 'work')
        return {
          runId: 'automatic',
          limits: {
            memoryBytes: 256 * 1024 * 1024,
            pids: 64,
            cpuQuotaMicros: 50_000,
            cpuPeriodMicros: 100_000,
            deadlineUnixMs: Date.now() + 30_000,
            cleanupTimeoutMs: 5000,
          },
          command: [payload],
          cwd: work,
          environment: {},
          files: {
            readOnlyFiles: [payload],
            readOnlyTrees: [],
            writableTrees: [work],
            protectedRoots: [join(allocation.directory, 'control')],
            network: 'isolated',
          },
          maxOutputBytes: 1,
          storage: { mountPath: data, bytes: 16 * 1024 * 1024, collect: null },
        }
      })
      const automaticParent = automatic.owner.owner.allocation.parent
      await automatic.closeInput()
      await expect(automatic.enforcement).resolves.toMatchObject({
        stopReason: 'payload_exit',
        exitCode: 1,
        fenced: true,
      })
      expect(
        await access(automaticParent).then(
          () => true,
          () => false,
        ),
      ).toBe(false)
      safeToRemove = true
    } finally {
      if (safeToRemove) await rm(root, { recursive: true })
      else console.error(`Native backend evidence retained at ${root}`)
    }
  },
  90_000,
)

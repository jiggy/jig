import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  initializePrivateActivationState,
  openPrivateProjectCoordinator,
} from '../../src/internal/activation-admission-store.js'
import { preparePrivateBunPackage } from '../../src/internal/bun-native-preparation.js'
import { withPrivateInstallationVerification } from '../../src/internal/installation-verification.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import {
  fixture,
  MACOS,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForCgroups,
  waitForTemporary,
} from '.././bun-native-preparation.fixture.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'

describe.serial('private contained Bun dependency preparation', () => {
  test('native evaluation preparation retains development closure after collector cleanup', async () => {
    const initialTemporary = new Set((await readdir(tmpdir())).filter(rootlessTemporaryEntry))
    const initialCgroups = new Set(await rootlessCgroups())
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-evaluation-preparation-')))
    const cleanupFailures: unknown[] = []
    let primaryFailure: { readonly error: unknown } | undefined
    try {
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'evaluation-preparation-consumer',
          private: true,
          dependencies: { 'is-number': '7.0.0' },
          devDependencies: { typescript: '5.7.3' },
        }),
      )
      const lock = Bun.spawn(
        [
          process.execPath,
          'install',
          '--lockfile-only',
          '--ignore-scripts',
          '--registry=https://registry.npmjs.org',
          '--no-progress',
        ],
        {
          cwd: root,
          env: {},
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exit, stdout, stderr] = await Promise.all([
        lock.exited,
        new Response(lock.stdout).text(),
        new Response(lock.stderr).text(),
      ])
      expect(exit, stdout + stderr).toBe(0)
      // Lock generation may populate Bun's local package cache even without installation.
      // The authored preparation input retains the real lock, not generated node_modules.
      await rm(join(root, 'node_modules'), { recursive: true, force: true })
      const captured = await capturePackageDirectory(root)
      try {
        expect(captured.files.map(({ path }) => path)).toEqual(['bun.lock', 'package.json'])
        await initializePrivateActivationState({ projectRoot: root })
        const coordinator = await openPrivateProjectCoordinator({ projectRoot: root })
        try {
          const host = await openPrivateInstalledBunHost(installedBunLocation)
          const prepared = await preparePrivateBunPackage({
            captured,
            mode: 'evaluation',
            installedSupport: host.installedBunSupport,
            backend: host.backend,
            projectRoot: root,
            coordinator,
          })
          try {
            expect(
              prepared.captured.files.some(
                ({ path }) => path === 'node_modules/typescript/lib/tsc.js',
              ),
            ).toBeTrue()
            expect(
              prepared.captured.files.some(
                ({ path }) => path === 'node_modules/is-number/index.js',
              ),
            ).toBeTrue()
            expect(await readdir(join(root, '.jig/private-preparation-owners'))).toEqual([])
            expect(
              (await prepared.captured.read('node_modules/typescript/lib/tsc.js')).byteLength,
            ).toBeGreaterThan(0)
            expect(Buffer.from(await prepared.captured.read('package.json'))).toEqual(
              Buffer.from(await captured.read('package.json')),
            )
          } finally {
            await prepared.captured.dispose().catch((error) => {
              cleanupFailures.push(error)
            })
          }
        } finally {
          await coordinator.dispose().catch((error) => {
            cleanupFailures.push(error)
          })
        }
      } finally {
        await captured.dispose().catch((error) => {
          cleanupFailures.push(error)
        })
      }
    } catch (error) {
      primaryFailure = { error }
    } finally {
      const settled = await Promise.allSettled([
        rm(root, { recursive: true, force: true }),
        waitForCgroups(initialCgroups),
        waitForTemporary(initialTemporary),
      ])
      for (const result of settled) {
        if (result.status === 'rejected') cleanupFailures.push(result.reason)
      }
    }
    const failures =
      primaryFailure === undefined ? cleanupFailures : [primaryFailure.error, ...cleanupFailures]
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw new AggregateError(failures, 'evaluation preparation test and cleanup failed')
  }, 60_000)

  test('workspace dependencies stay project-local while code edits assemble fresh reviewed source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-workspace-reuse-'))
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
    }
    try {
      await put('package.json', { private: true, workspaces: ['apps/*/flows/*', 'libs/*'] })
      await put('libs/helper/package.json', {
        name: 'helper',
        version: '1.0.0',
        type: 'module',
        exports: './index.js',
      })
      await put('libs/helper/index.js', 'export const value = 1')
      // The enclosing Jig project selects the exact same Flow and workspace
      // capture as project a, but owns a different approval store.
      await put(
        'jig.ts',
        "import { defineJig, discover } from '@jigging/jig'; export default defineJig({ flows: discover('apps/a/flows') })",
      )
      for (const project of ['a', 'b']) {
        await put(
          `apps/${project}/jig.ts`,
          "import { defineJig, discover } from '@jigging/jig'; export default defineJig({ flows: discover('flows') })",
        )
        await put(`apps/${project}/flows/work/package.json`, {
          name: `${project}-work`,
          type: 'module',
          dependencies: { helper: 'workspace:*' },
        })
        await put(`apps/${project}/flows/work/FLOW.meta.json`, {
          name: 'work',
          description: 'Workspace reuse proof.',
        })
        await put(
          `apps/${project}/flows/work/FLOW.ts`,
          "import { value } from 'helper'; void value",
        )
      }
      await withPrivateInstallationVerification(
        { ...process.env, JIG_VERIFICATION: 'cached', XDG_CACHE_HOME: join(root, 'cache') },
        async () => {
          const host = await openPrivateInstalledBunHost(installedBunLocation, {})
          let reviewSequence = 0
          const review = async (project: string, allowResolutionNetwork: boolean, apply = true) => {
            const sequence = ++reviewSequence
            const stages: string[] = []
            let operationFailure: unknown
            const session = await openPrivateProjectSession({
              directory: join(root, 'apps', project),
              host: { ...host, allowResolutionNetwork, onStage: (stage) => stages.push(stage) },
              onOperationFailure: (evidence) => {
                operationFailure = evidence
              },
            })
            try {
              const plan = await session.plan({ lockMode: 'update' })
              if (apply && plan.state === 'applicable')
                await session.apply({ planDigest: plan.planDigest })
              return { plan, stages }
            } catch (error) {
              const failure = error as { diagnostic?: { code?: unknown } }
              if (
                failure?.diagnostic?.code === 'PACKAGE_BUN_PREPARATION_FAILED' ||
                (failure as { code?: unknown })?.code === 'INTERNAL'
              ) {
                console.error(
                  'workspace-preparation-failed',
                  JSON.stringify({
                    sequence,
                    project,
                    allowResolutionNetwork,
                    stages: stages.map((stage) =>
                      stage.startsWith('Preparing dependencies')
                        ? 'prepare'
                        : stage.startsWith('Reusing approved dependencies')
                          ? 'reuse'
                          : 'other',
                    ),
                    operationFailure,
                  }),
                )
              }
              throw error
            } finally {
              await session.close()
            }
          }
          const first = await review('a', true, false)
          expect(
            first.stages.filter((stage) => stage.startsWith('Preparing dependencies')),
          ).toHaveLength(1)
          // A declined/unapproved preparation supplies no reusable admission.
          await expect(review('a', false)).rejects.toMatchObject({
            diagnostic: { code: 'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED' },
          })
          await review('a', true)
          const warm = await review('a', false)
          expect(warm.plan.state).toBe('unchanged')
          expect(
            warm.stages.some((stage) => stage.startsWith('Reusing approved dependencies')),
          ).toBeTrue()
          expect(
            warm.stages.some((stage) => stage.startsWith('Preparing dependencies')),
          ).toBeFalse()
          await expect(review('..', false)).rejects.toMatchObject({
            diagnostic: { code: 'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED' },
          })
          // Same ancestor workspace and shared library, but a different Jig project.
          await expect(review('b', false)).rejects.toMatchObject({
            diagnostic: { code: 'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED' },
          })
          expect(
            (await review('b', true)).stages.some((stage) =>
              stage.startsWith('Preparing dependencies'),
            ),
          ).toBeTrue()
          await put('libs/helper/index.js', 'export const value = 2')
          const edited = await review('a', false)
          expect(edited.plan.state).toBe('applicable')
          expect(
            edited.stages.some((stage) => stage.startsWith('Reusing approved dependencies')),
          ).toBeTrue()
          expect(
            edited.stages.some((stage) => stage.startsWith('Preparing dependencies')),
          ).toBeFalse()
          expect((await review('a', false)).plan.state).toBe('unchanged')
          await put('libs/helper/added.txt', 'new captured file')
          expect((await review('a', false)).plan.state).toBe('applicable')
          await rm(join(root, 'libs/helper/added.txt'))
          expect((await review('a', false)).plan.state).toBe('applicable')
          expect((await review('a', false)).plan.state).toBe('unchanged')
          await put('package.json', {
            private: true,
            description: 'Changed workspace metadata',
            workspaces: ['apps/*/flows/*', 'libs/*'],
          })
          await expect(review('a', false)).rejects.toMatchObject({
            diagnostic: { code: 'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED' },
          })
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 180_000)
  for (const [suiteCaseIndex, suiteCaseValue] of (
    [
      { resolve: false, lockVersion: 1 },
      ...(MACOS ? [{ resolve: false, lockVersion: 2 as const }] : []),
      { resolve: true, lockVersion: MACOS ? 2 : 1 },
    ] as const
  ).entries()) {
    test(
      'prepares a transitive graph without scripts or authored config (%j)' +
        ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async ({ resolve, lockVersion }) => {
            const initialTemporary = new Set(
              (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
            )
            const initialCgroups = new Set(await rootlessCgroups())
            const root = await fixture(lockVersion)
            const authoredLock = await readFile(join(root, 'bun.lock'))
            try {
              if (resolve) {
                await rm(join(root, 'bun.lock'))
                for (const path of [
                  'bun.lockb',
                  'package-lock.json',
                  'yarn.lock',
                  'pnpm-lock.yaml',
                ]) {
                  await writeFile(join(root, path), 'not a lock; must remain inert')
                }
              }
              const captured = await capturePackageDirectory(root)
              try {
                await initializePrivateActivationState({ projectRoot: root })
                const coordinator = await openPrivateProjectCoordinator({ projectRoot: root })
                try {
                  const host = await openPrivateInstalledBunHost(installedBunLocation)
                  if (resolve)
                    await expect(
                      preparePrivateBunPackage({
                        captured,
                        installedSupport: host.installedBunSupport,
                        backend: host.backend,
                        projectRoot: root,
                        coordinator,
                      }),
                    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED' })
                  const first = await preparePrivateBunPackage({
                    captured,
                    installedSupport: host.installedBunSupport,
                    backend: host.backend,
                    projectRoot: root,
                    coordinator,
                    allowResolutionNetwork: resolve,
                  })
                  try {
                    expect(first.layout).toEqual({ flowRoot: '', members: [], aliases: [] })
                    expect(
                      first.captured.files.some(
                        ({ path }) => path === 'node_modules/is-number/index.js',
                      ),
                    ).toBeTrue()
                    expect(
                      first.captured.files.some(
                        ({ path }) => path === 'node_modules/is-odd/index.js',
                      ),
                    ).toBeTrue()
                    expect(
                      first.captured.files.some(({ path }) => path === 'node_modules/zod/index.js'),
                    ).toBeTrue()
                    expect(
                      first.captured.files.some(({ path }) => path === 'postinstall-ran'),
                    ).toBeFalse()
                    expect(
                      first.captured.files.some(({ path }) => path.includes('/.bin/')),
                    ).toBeFalse()
                    expect(
                      new TextDecoder().decode(await first.captured.read('FLOW.ts')),
                    ).toContain('from "is-odd"')
                    expect(first.captured.files.some(({ path }) => path === 'bun.lock')).toBeTrue()
                    if (resolve) {
                      await expect(readFile(join(root, 'bun.lock'))).rejects.toMatchObject({
                        code: 'ENOENT',
                      })
                      expect(
                        new TextDecoder().decode(await first.captured.read('package-lock.json')),
                      ).toBe('not a lock; must remain inert')
                    } else {
                      expect(Buffer.from(await first.captured.read('bun.lock'))).toEqual(
                        authoredLock,
                      )
                      expect(await readFile(join(root, 'bun.lock'))).toEqual(authoredLock)
                    }

                    const second = await preparePrivateBunPackage({
                      captured,
                      installedSupport: host.installedBunSupport,
                      backend: host.backend,
                      projectRoot: root,
                      coordinator,
                      allowResolutionNetwork: resolve,
                    })
                    try {
                      expect(second.layout).toEqual({ flowRoot: '', members: [], aliases: [] })
                      // Only an authored lock promises the same dependency selection
                      // across two fresh preparations.
                      if (!resolve) expect(second.captured.digest).toBe(first.captured.digest)
                    } finally {
                      await second.captured.dispose()
                    }
                  } finally {
                    await first.captured.dispose()
                  }
                } finally {
                  await coordinator.dispose()
                }
              } finally {
                await captured.dispose()
              }
              await waitForCgroups(initialCgroups)
              await waitForTemporary(initialTemporary)
            } finally {
              await rm(root, { recursive: true, force: true })
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
      120_000,
    )
  }
  for (const [suiteCaseIndex, suiteCaseValue] of (['source', 'format'] as const).entries()) {
    test(
      'rejects an unsupported lock %s before installer fetch' + ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (kind) => {
            const root = await fixture()
            try {
              await writeFile(
                join(root, 'bun.lock'),
                `${JSON.stringify(
                  {
                    lockfileVersion: kind === 'format' ? 3 : MACOS ? 2 : 1,
                    workspaces: { '': { dependencies: { local: 'file:../local' } } },
                    packages: { local: ['local@file:../local', {}] },
                  },
                  null,
                  2,
                )}\n`,
              )
              const captured = await capturePackageDirectory(root)
              try {
                await initializePrivateActivationState({ projectRoot: root })
                const coordinator = await openPrivateProjectCoordinator({ projectRoot: root })
                try {
                  const host = await openPrivateInstalledBunHost(installedBunLocation)
                  await expect(
                    preparePrivateBunPackage({
                      captured,
                      installedSupport: host.installedBunSupport,
                      backend: host.backend,
                      projectRoot: root,
                      coordinator,
                    }),
                  ).rejects.toMatchObject({
                    code:
                      kind === 'format'
                        ? 'PACKAGE_BUN_LOCK_VERSION_UNSUPPORTED'
                        : 'PACKAGE_BUN_SOURCE_UNSUPPORTED',
                    path: 'bun.lock',
                  })
                } finally {
                  await coordinator.dispose()
                }
              } finally {
                await captured.dispose()
              }
            } finally {
              await rm(root, { recursive: true, force: true })
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
      30_000,
    )
  }
})

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires opted-in native host qualification')

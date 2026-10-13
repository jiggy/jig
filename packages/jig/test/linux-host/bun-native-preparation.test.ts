import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initializePrivateActivationState,
  openPrivateProjectCoordinator,
  readPrivateBunPreparationOwner,
} from '../../src/internal/activation-admission-store.js'
import { preparePrivateBunPackage } from '../../src/internal/bun-native-preparation.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import {
  childClose,
  collectChild,
  fixture,
  recoverEventually,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForActivePreparation,
  waitForCgroups,
  waitForTemporary,
} from '.././bun-native-preparation.fixture.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'

describe.serial('private contained Bun dependency preparation', () => {
  for (const [suiteCaseIndex, suiteCaseValue] of [false, true].entries()) {
    test(
      'recovers preparation after coordinator loss (resolve=%s)' + ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (resolve) => {
            const projectRoot = await mkdtemp(join(tmpdir(), 'jig-bun-preparation-project-'))
            const packageRoot = await fixture()
            const initialTemporary = new Set(
              (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
            )
            const initialCgroups = new Set(await rootlessCgroups())
            try {
              if (resolve) await rm(join(packageRoot, 'bun.lock'))
              await initializePrivateActivationState({ projectRoot })
              const helper = spawn(
                process.execPath,
                [
                  '--no-env-file',
                  '--no-install',
                  '--config=/dev/null',
                  join(suiteTestRoot, 'fixtures', 'bun-preparation-coordinator.ts'),
                  projectRoot,
                  packageRoot,
                  ...(resolve ? ['--allow-resolution-network'] : []),
                ],
                {
                  cwd: '/',
                  env: process.env,
                  stdio: ['ignore', 'pipe', 'pipe'],
                },
              )
              const closed = childClose(helper)
              const diagnostics = collectChild(helper.stderr)
              await Promise.race([
                waitForActivePreparation(projectRoot),
                closed.then(async (exit) => {
                  throw new Error(
                    `preparation helper exited before activation (${exit.code ?? exit.signal}): ${await diagnostics}`,
                  )
                }),
              ])
              helper.kill('SIGKILL')
              const exit = await closed
              expect(exit.signal).toBe('SIGKILL')

              const host = await openPrivateInstalledBunHost(installedBunLocation)
              const coordinator = await openPrivateProjectCoordinator({ projectRoot })
              try {
                await recoverEventually({
                  projectRoot,
                  coordinator,
                  backend: host.backend,
                })
                expect(
                  await readPrivateBunPreparationOwner({ projectRoot, coordinator }),
                ).toBeNull()
                const captured = await capturePackageDirectory(packageRoot)
                try {
                  const prepared = await preparePrivateBunPackage({
                    captured,
                    installedSupport: host.installedBunSupport,
                    backend: host.backend,
                    projectRoot,
                    coordinator,
                    allowResolutionNetwork: resolve,
                  })
                  expect(prepared.layout).toEqual({ flowRoot: '', members: [], aliases: [] })
                  await prepared.captured.dispose()
                } finally {
                  await captured.dispose()
                }
              } finally {
                await coordinator.dispose()
              }
              await waitForCgroups(initialCgroups)
              await waitForTemporary(initialTemporary)
              expect(
                await readdir(join(projectRoot, '.jig', 'private-preparation-owners')),
              ).toEqual([])
            } finally {
              await Promise.all([
                rm(projectRoot, { recursive: true, force: true }),
                rm(packageRoot, { recursive: true, force: true }),
              ])
            }
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
      120_000,
    )
  }
})

if (process.platform !== 'linux' || process.env.JIG_LINUX_ROOTLESS_HOSTILE !== '1')
  throw Error('This suite requires opted-in rootless Linux qualification')

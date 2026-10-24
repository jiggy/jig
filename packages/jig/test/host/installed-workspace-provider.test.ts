import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { caller, cli, contract, peer } from '../fixtures/installed-provider.js'
import {
  profilePhaseSummary,
  reviewCommandEnvironment,
} from '../fixtures/private-profile-diagnostics.js'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

for (const location of ['member', 'root', 'nested'] as const) {
  test(`installed CLI reviews and runs a workspace dependency (application: ${location})`, async () => {
    const rootApplication = location === 'root'
    const nested = location === 'nested'
    const directory = await mkdtemp(join(tmpdir(), 'jig-npm-consumer-'))
    const evidence = await realpath(await mkdtemp(join(tmpdir(), 'jig-workspace-review-profile-')))
    let sequence = 0
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(
        join(directory, path),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    const project = rootApplication ? directory : join(directory, 'apps/consumer')
    const putApp = (path: string, value: unknown) =>
      put(rootApplication ? path : `apps/consumer/${path}`, value)
    const run = async (args: string[], interrupt = false) => {
      const env = reviewCommandEnvironment(args[0], join(evidence, `${++sequence}.review.jsonl`), {
        ...process.env,
        NO_COLOR: '1',
      })
      const child = Bun.spawn([cli, ...args], {
        cwd: project,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      // The host may retain Flow stderr until settlement, so it is not a
      // reliable signal that the held Run is still active.
      let interruptEvidence: { sent: boolean; error?: string } | undefined
      const interruptTimer = interrupt
        ? setTimeout(() => {
            try {
              process.kill(child.pid, 'SIGTERM')
              interruptEvidence = { sent: true }
            } catch (error) {
              interruptEvidence = {
                sent: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }, 20_000)
        : undefined
      try {
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        const profile =
          exit !== 0 && env.JIG_PRIVATE_PROFILE_FILE !== undefined
            ? await profilePhaseSummary(env.JIG_PRIVATE_PROFILE_FILE, 'review')
            : undefined
        return {
          exit,
          stdout,
          stderr: `${stderr}${profile === undefined ? '' : `\nReview phases: ${profile}`}`,
          interruptEvidence,
        }
      } finally {
        if (interruptTimer !== undefined) clearTimeout(interruptTimer)
      }
    }
    let passed = false
    try {
      await put('package.json', {
        private: true,
        workspaces: ['apps/*', 'packages/*', ...(nested ? ['apps/*/flows/*'] : [])],
        patchedDependencies: { 'is-number@6.0.0': 'patches/is-number.patch' },
        ...(rootApplication
          ? { name: 'consumer', type: 'module', dependencies: { 'echo-method': 'workspace:*' } }
          : {}),
      })
      await put(
        'patches/is-number.patch',
        [
          'diff --git a/jig-patch.js b/jig-patch.js',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/jig-patch.js',
          '@@ -0,0 +1 @@',
          '+module.exports = "captured patch";',
          '',
        ].join('\n'),
      )
      if (!rootApplication)
        await putApp('package.json', {
          name: 'consumer',
          type: 'module',
          dependencies: { 'echo-method': nested ? '1.0.0' : 'workspace:*' },
          ...(nested ? { workspaces: ['flows/*'] } : {}),
        })
      await putApp(
        'jig.ts',
        `import {defineJig,discover} from '@jigging/jig'; export default defineJig({ flows:discover('flows'),bindings:discover('bindings'), defaultProviders: { 'https://example.org/contracts/echo': 'npm:echo-method' } });`,
      )
      await putApp(
        'flows/caller/FLOW.ts',
        nested
          ? `import {marker} from 'workspace-context'; if(marker !== 'outer workspace') throw new Error('wrong workspace source');\n${caller}`
          : caller,
      )
      if (nested) {
        await putApp('flows/caller/package.json', {
          name: 'echo-caller',
          type: 'module',
          dependencies: { 'workspace-context': '0.0.0-alpha.999999' },
        })
        await put('packages/context/package.json', {
          name: 'workspace-context',
          version: '0.0.0-alpha.999999',
          type: 'module',
          exports: './index.js',
        })
        await put('packages/context/index.js', 'export const marker = "outer workspace"')
      }
      await putApp('flows/caller/FLOW.meta.json', {
        uses: { worker: { contract: './echo.json' } },
      })
      await putApp('flows/caller/echo.json', contract)
      await putApp(
        'bindings/echo.ts',
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'npm:echo-method'});`,
      )
      await put('packages/echo/package.json', {
        name: 'echo-method',
        version: '1.0.0',
        type: 'module',
        files: ['FLOW.ts', 'FLOW.contract.json'],
        dependencies: { 'is-number': '6.0.0' },
      })
      await put('packages/echo/FLOW.ts', peer)
      await put('packages/echo/FLOW.contract.json', contract)
      const review = await run(['review', '--yes', '--allow-resolution-network'])
      expect(review.exit, review.stdout + review.stderr).toBe(0)
      const result = await run([
        'run',
        'npm:echo-method',
        '--input',
        '"declared package"',
        '--timeout',
        '120s',
        '--json',
      ])
      expect(result.exit, result.stdout + result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        output: 'declared package',
      })
      for (const target of ['binding:echo', 'flow:flows/caller']) {
        const invoked = await run([
          'run',
          target,
          '--input',
          '"through selected provider"',
          '--timeout',
          '120s',
          '--json',
        ])
        expect(invoked.exit, invoked.stdout + invoked.stderr).toBe(0)
        expect(JSON.parse(invoked.stdout)).toMatchObject({
          status: 'succeeded',
          output: 'through selected provider',
        })
        expect(JSON.parse(invoked.stdout).runDiagnostics.entries).toContainEqual({
          operations: target === 'flow:flows/caller' ? ['echo'] : [],
          stderr: 'dependency diagnostic\n',
          stderrBytes: 22,
          stderrTruncated: false,
        })
      }
      const cancelled = await run(
        ['run', 'npm:echo-method', '--input', '"hold"', '--timeout', '120s', '--json'],
        true,
      )
      expect(cancelled.interruptEvidence).toEqual({ sent: true })
      expect(cancelled.exit, cancelled.stderr).toBe(2)
      expect(JSON.parse(cancelled.stdout)).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
        command: { status: 'interrupted' },
      })
      const inspect = await run(['inspect', 'npm:echo-method', '--json'])
      expect(inspect.exit, inspect.stderr).toBe(0)
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        target: 'npm:echo-method',
        contract: { id: contract.id },
      })
      const before = await readFile(join(project, 'jig.lock'), 'utf8')
      const originalPatch = await readFile(join(directory, 'patches/is-number.patch'), 'utf8')
      await put('packages/echo/FLOW.ts', 'throw new Error("unreviewed source must not run")')
      await put('patches/is-number.patch', 'unreviewed patch must not replace retained bytes')
      const pinned = await run([
        'run',
        'npm:echo-method',
        '--input',
        '"retained"',
        '--timeout',
        '120s',
        '--json',
      ])
      expect(pinned.exit, pinned.stdout + pinned.stderr).toBe(0)
      expect(JSON.parse(pinned.stdout)).toMatchObject({ output: 'retained' })
      expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(before)
      await put('patches/is-number.patch', originalPatch)
      // Review retains its generated lock privately; an authored stale lock
      // must be created through Bun before changing the manifest.
      execFileSync(
        process.execPath,
        ['--no-env-file', 'install', '--lockfile-only', '--ignore-scripts', '--config=/dev/null'],
        {
          cwd: directory,
          timeout: 30_000,
          stdio: 'pipe',
        },
      )
      const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
      const changedManifest = { ...manifest, name: 'changed-without-updating-lock' }
      if (rootApplication) {
        const authoredLock = await readFile(join(directory, 'bun.lock'), 'utf8')
        await putApp('package.json', { ...changedManifest, version: '2.0.0' })
        const metadataReview = await run(['review', '--yes'])
        expect(metadataReview.exit, metadataReview.stdout + metadataReview.stderr).toBe(0)
        expect(await readFile(join(directory, 'bun.lock'), 'utf8')).toBe(authoredLock)
        // A real root dependency change still requires an explicit lock update.
        await putApp('package.json', {
          ...changedManifest,
          version: '2.0.0',
          dependencies: { ...manifest.dependencies, 'is-number': '6.0.0' },
        })
      } else {
        await putApp('package.json', changedManifest)
      }
      const beforeRefusal = await readFile(join(project, 'jig.lock'), 'utf8')
      const stale = await run(['review', '--yes'])
      expect(stale.exit, stale.stdout + stale.stderr).not.toBe(0)
      expect(stale.stderr).toContain('PACKAGE_BUN_LOCK_STALE')
      expect(stale.stderr).toContain(rootApplication ? '/dependencies' : '/name')
      expect(stale.stderr).not.toContain('changed-without-updating-lock')
      const lockRoot = rootApplication ? '.' : '../..'
      const lockPath = rootApplication ? 'bun.lock' : '../../bun.lock'
      expect(stale.stderr).toContain(`Dependency lock: "${lockPath}"`)
      const repair = /\$ (bun install --lockfile-only --ignore-scripts --cwd '[^']+')/.exec(
        stale.stderr,
      )
      expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(beforeRefusal)
      expect(repair?.[1]).toBe(`bun install --lockfile-only --ignore-scripts --cwd '${lockRoot}'`)
      if (repair?.[1] === undefined) throw new Error('Missing public lock repair command')
      execFileSync('/bin/sh', ['-c', repair[1]], {
        cwd: project,
        timeout: 30_000,
        stdio: 'pipe',
      })
      const repaired = await run(['review', '--yes'])
      expect(repaired.exit, repaired.stdout + repaired.stderr).toBe(0)
      passed = true
    } finally {
      if (passed) {
        await rm(directory, { recursive: true, force: true })
        await rm(evidence, { recursive: true, force: true })
      } else console.error(`Preserved package-provider consumer: ${directory}`)
    }
  }, 240_000)
}

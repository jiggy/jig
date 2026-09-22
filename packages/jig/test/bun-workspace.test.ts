import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizePrivateBunExecutionLayout } from '../src/internal/bun-execution-layout.js'
import { requirePrivateBunLockPolicy } from '../src/internal/bun-native-lock-policy.js'
import { capturePrivateBunWorkspace } from '../src/internal/bun-workspace-capture.js'
import { privatePackageAliasText } from '../src/internal/package-aliases.js'
import {
  projectError,
  scopePrivatePackagePlanningError,
} from '../src/internal/project-session-controller.js'
import { captureOpenedPackageDirectory, capturePackageDirectory } from '../src/package/capture.js'
import { captureFlowSource } from '../src/project/flow-source.js'
import { openPrivateProjectRoot } from '../src/project/root.js'

const target = 'apps/demo/flows/work'

test.each([
  [
    'package.json',
    '../../package.json',
    {
      workspaces: ['apps/*/flows/*', 'libs/*'],
      devDependencies: { '@example/tool': 'file:/private/path' },
    },
    'SOURCE',
    '/devDependencies/@example~1tool',
  ],
  [
    'libs/unrelated/package.json',
    '../../libs/unrelated/package.json',
    { name: 'unrelated', overrides: { x: 'secret' } },
    'FIELD',
    '/overrides',
  ],
  [
    'libs/helper/package.json',
    '../../libs/helper/package.json',
    { name: 'helper', dependencies: { leaf: 'https://credential@host/private' } },
    'SOURCE',
    '/dependencies/leaf',
  ],
] as const)(
  'workspace refusal locates %s without rebasing it onto the Flow',
  async (path, expectedPath, manifest, reason, pointer) => {
    const value = await fixture()
    try {
      await value.put(path, manifest)
      let failure: unknown
      try {
        await value.capture()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        code: `PACKAGE_BUN_MANIFEST_${reason}`,
        path: expectedPath,
        pointer,
      })
      const scoped = scopePrivatePackagePlanningError(failure, 'flows/work')
      expect(scoped).toBe(failure)
      const projected = projectError(scoped, 'plan').toJSON()
      expect(projected.diagnostic).toEqual({
        code: `PACKAGE_BUN_MANIFEST_${reason}`,
        path: expectedPath,
        pointer,
      })
      expect(JSON.stringify(projected)).not.toMatch(/secret|credential|private\/path/)
    } finally {
      await value.dispose()
    }
  },
)

async function fixture(versions = false, rootApplication = false) {
  const root = await mkdtemp(join(tmpdir(), 'jig-workspace-'))
  const put = async (path: string, value: unknown) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  await put('package.json', {
    private: true,
    workspaces: ['apps/*/flows/*', 'libs/*'],
    ...(versions ? { dependencies: { semver: '6.3.1' } } : {}),
    ...(rootApplication ? { name: 'root-app', dependencies: { helper: 'workspace:*' } } : {}),
  })
  await put(`${target}/package.json`, {
    name: 'work-flow',
    type: 'module',
    dependencies: { helper: 'workspace:*', ...(versions ? { semver: '7.7.2' } : {}) },
  })
  await put(`${target}/flow.meta.json`, { name: 'work', description: 'Workspace fixture.' })
  await put(
    `${target}/FLOW.ts`,
    versions
      ? 'import { message } from "helper"; import version from "semver/package.json"; console.log(JSON.stringify([message, version.version]))\n'
      : 'import { message } from "helper"; console.log(message)\n',
  )
  await put('libs/helper/package.json', {
    name: 'helper',
    version: '0.1.0',
    type: 'module',
    files: ['dist'],
    exports: './dist/index.js',
    dependencies: { leaf: 'workspace:*', ...(versions ? { semver: '6.3.1' } : {}) },
  })
  await put(
    'libs/helper/dist/index.js',
    versions
      ? 'import version from "semver/package.json"; export const message = version.version\n'
      : 'export { message } from "leaf"\n',
  )
  await put('libs/helper/private-note', 'not selected by package files')
  await put('libs/leaf/package.json', {
    name: 'leaf',
    version: '0.1.0',
    type: 'module',
    exports: './index.js',
    dependencies: {},
  })
  await put('libs/leaf/index.js', 'export const message = "workspace bytes"\n')
  await put('libs/unrelated/package.json', { name: 'unrelated', version: '0.1.0' })
  await put('libs/unrelated/secret', 'unrelated source must not be captured')
  const project = await openPrivateProjectRoot(rootApplication ? root : join(root, 'apps/demo'))
  const source = rootApplication
    ? await captureOpenedPackageDirectory('root metadata', project.handle, {
        includes: (path) => ['package.json', 'bun.lock'].includes(path),
        maximumFiles: 2,
        maximumBytes: 3 * 1024 * 1024,
      })
    : await capturePackageDirectory(join(root, target))
  const capture = () =>
    capturePrivateBunWorkspace({
      projectRoot: project,
      packagePath: rootApplication ? '' : 'flows/work',
      captured: source,
      signal: new AbortController().signal,
    })
  return {
    root,
    put,
    capture,
    source,
    async dispose() {
      await source.dispose()
      await project.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

test('workspace capture follows declared transitive members, not installation links or unrelated source', async () => {
  const value = await fixture()
  try {
    await mkdir(join(value.root, 'libs/helper/node_modules'))
    await symlink('/definitely/not/a/workspace', join(value.root, 'libs/helper/node_modules/leaf'))
    const captured = (await value.capture())!
    try {
      expect(captured.target).toBe(target)
      expect(captured.selected).toEqual([target, 'libs/helper', 'libs/leaf'])
      const paths = captured.captured.files.map(({ path }) => path)
      expect(paths).toContain('libs/helper/dist/index.js')
      expect(paths).toContain('libs/leaf/index.js')
      expect(paths).not.toContain('libs/helper/private-note')
      expect(paths).not.toContain('libs/unrelated/secret')
      expect(paths.some((path) => path.includes('node_modules'))).toBeFalse()
      await value.put('libs/leaf/index.js', 'export const message = "changed"\n')
      expect(
        new TextDecoder().decode(await captured.captured.read('libs/leaf/index.js')),
      ).toContain('workspace bytes')
      const next = (await value.capture())!
      try {
        expect(next.captured.digest).not.toBe(captured.captured.digest)
      } finally {
        await next.captured.dispose()
      }
    } finally {
      await captured.captured.dispose()
    }
  } finally {
    await value.dispose()
  }
})

test('workspace patches are immutable captured inputs, including patches inside selected members', async () => {
  const value = await fixture()
  try {
    const path = 'libs/leaf/fix.patch'
    await value.put('package.json', {
      private: true,
      workspaces: ['apps/*/flows/*', 'libs/*'],
      patchedDependencies: { 'value@1.0.0': path },
    })
    await value.put(path, 'original patch bytes')
    const first = (await value.capture())!
    try {
      await value.put(path, 'changed patch bytes')
      expect(Buffer.from(await first.captured.read(path)).toString()).toBe('original patch bytes')
      const second = (await value.capture())!
      try {
        expect(first.captured.digest).not.toBe(second.captured.digest)
      } finally {
        await second.captured.dispose()
      }
    } finally {
      await first.captured.dispose()
    }
  } finally {
    await value.dispose()
  }
})

test.each(['missing', 'link', 'directory-link', 'oversized', 'escape'] as const)(
  'workspace patch capture rejects %s',
  async (mode) => {
    const value = await fixture()
    try {
      await value.put('package.json', {
        private: true,
        workspaces: ['apps/*/flows/*', 'libs/*'],
        patchedDependencies: {
          'value@1.0.0': mode === 'escape' ? '../outside.patch' : 'patches/fix.patch',
        },
      })
      await mkdir(join(value.root, 'patches'))
      if (mode === 'link') await symlink('/etc/passwd', join(value.root, 'patches/fix.patch'))
      if (mode === 'directory-link') {
        await rm(join(value.root, 'patches'), { recursive: true })
        await symlink('/etc', join(value.root, 'patches'))
      }
      if (mode === 'oversized') await value.put('patches/fix.patch', 'x'.repeat(1024 * 1024 + 1))
      await expect(value.capture()).rejects.toMatchObject({
        code: mode === 'escape' ? 'PACKAGE_BUN_MANIFEST_PATCH' : 'PACKAGE_BUN_WORKSPACE_INVALID',
      })
    } finally {
      await value.dispose()
    }
  },
)

test.each(['missing', 'version', 'link', 'export', 'duplicate', 'escape', 'limit'] as const)(
  'workspace capture rejects %s without registry fallback',
  async (mode) => {
    const value = await fixture()
    try {
      const codes = {
        missing: 'PACKAGE_BUN_WORKSPACE_MISSING',
        version: 'PACKAGE_BUN_WORKSPACE_VERSION',
        link: 'PACKAGE_BUN_WORKSPACE_INVALID',
        export: 'PACKAGE_BUN_WORKSPACE_BUILD_REQUIRED',
        duplicate: 'PACKAGE_BUN_WORKSPACE_INVALID',
        escape: 'PACKAGE_BUN_WORKSPACE_INVALID',
        limit: 'PACKAGE_BUN_INPUT_LIMIT',
      }
      if (mode === 'missing') await rm(join(value.root, 'libs/leaf'), { recursive: true })
      if (mode === 'version')
        await value.put('libs/helper/package.json', {
          name: 'helper',
          version: '0.1.0',
          dependencies: { leaf: 'workspace:^2.0.0' },
        })
      if (mode === 'link') {
        await rm(join(value.root, 'libs/leaf/index.js'))
        await symlink('/etc/passwd', join(value.root, 'libs/leaf/index.js'))
      }
      if (mode === 'export') await rm(join(value.root, 'libs/helper/dist'), { recursive: true })
      if (mode === 'duplicate') await value.put('libs/unrelated/package.json', { name: 'leaf' })
      if (mode === 'escape')
        await value.put('package.json', { workspaces: ['../outside', 'apps/*/flows/*'] })
      if (mode === 'limit')
        await writeFile(join(value.root, 'libs/leaf/oversize'), Buffer.alloc(17 * 1024 * 1024))
      await expect(value.capture()).rejects.toMatchObject({ code: codes[mode] })
    } finally {
      await value.dispose()
    }
  },
)

test('ordinary Flow discovery excludes generated node_modules without changing authored source', async () => {
  const value = await fixture()
  try {
    await mkdir(join(value.root, target, 'node_modules'))
    await symlink('/etc', join(value.root, target, 'node_modules/generated-link'))
    const captured = await captureFlowSource(join(value.root, 'apps/demo'), {
      kind: 'members',
      paths: ['flows/work'],
    })
    try {
      expect(captured.members[0]!.captured.digest).toBe(value.source.digest)
    } finally {
      await captured.dispose()
    }
  } finally {
    await value.dispose()
  }
})

test('workspace file patterns exclude unwanted content and preserve cancellation', async () => {
  const value = await fixture()
  try {
    await value.put('libs/helper/package.json', {
      name: 'helper',
      type: 'module',
      files: ['dist', '!dist/private*'],
      exports: './dist/index.js',
      dependencies: { leaf: 'workspace:*' },
    })
    await value.put('libs/helper/dist/private-note', 'not retained')
    const captured = (await value.capture())!
    try {
      expect(captured.captured.files.some(({ path }) => path.endsWith('private-note'))).toBeFalse()
    } finally {
      await captured.captured.dispose()
    }
    const project = await openPrivateProjectRoot(join(value.root, 'apps/demo'))
    try {
      const reason = new Error('cancel workspace capture')
      await expect(
        capturePrivateBunWorkspace({
          projectRoot: project,
          packagePath: 'flows/work',
          captured: value.source,
          signal: AbortSignal.abort(reason),
        }),
      ).rejects.toBe(reason)
    } finally {
      await project.dispose()
    }
  } finally {
    await value.dispose()
  }
})

test('workspace lock resolution cannot introduce undeclared paths or names', () => {
  const lock = {
    lockfileVersion: 1,
    workspaces: { '': {}, 'libs/helper': { name: 'helper' } },
    packages: { helper: ['helper@workspace:libs/helper'] },
  }
  expect(() => requirePrivateBunLockPolicy(lock, new Set(['libs/helper']))).not.toThrow()
  expect(() => requirePrivateBunLockPolicy(lock)).toThrow()
  expect(() => requirePrivateBunLockPolicy(lock, new Set(['libs/other']))).toThrow()
  expect(() =>
    requirePrivateBunLockPolicy(
      { ...lock, packages: { helper: ['other@workspace:libs/helper'] } },
      new Set(['libs/helper']),
    ),
  ).toThrow()
})

// Real pinned Bun worker, with only /work relocated into a disposable fixture.
// These tests prove capture/install semantics, not the containment envelope.
test.each([
  'unlocked',
  'locked',
  'stale',
  'topology',
  'versions',
  'large',
  'patched',
  'patch-stale',
  'patch-missing',
  'patch-invalid',
  'root',
  'root-stale',
] as const)(
  'Bun prepares a self-contained workspace tree: %s',
  async (mode) => {
    const patchMode = mode === 'patched' || mode.startsWith('patch-')
    const rootApplication = mode === 'root' || mode === 'root-stale'
    const value = await fixture(mode === 'versions' || patchMode, rootApplication)
    let captured: Awaited<ReturnType<typeof value.capture>>
    try {
      if (patchMode) {
        await value.put('package.json', {
          private: true,
          workspaces: ['apps/*/flows/*', 'libs/*'],
          dependencies: { semver: '6.3.1' },
          patchedDependencies: { 'semver@6.3.1': 'patches/semver.patch' },
        })
        await value.put(
          'patches/semver.patch',
          [
            'diff --git a/jig-patch.js b/jig-patch.js',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/jig-patch.js',
            '@@ -0,0 +1 @@',
            '+module.exports = "patched dependency";',
            '',
          ].join('\n'),
        )
      }
      if (mode === 'large') await value.put('libs/leaf/large.txt', 'x'.repeat(2 * 1024 * 1024))
      if (mode === 'topology') {
        await value.put('libs/helper/package.json', {
          name: 'helper',
          version: '0.1.0',
          type: 'module',
          files: ['dist'],
          exports: './dist/index.js',
          dependencies: { leaf: 'workspace:*', side: 'workspace:*' },
        })
        await value.put(
          'libs/helper/dist/index.js',
          'import { marker, getHelper, readAsset } from "leaf"; import { marker as other } from "side"; export const token = {}; export const message = JSON.stringify({same: marker === other, cyclic: getHelper() === token, asset: readAsset()})',
        )
        await value.put('libs/leaf/package.json', {
          name: 'leaf',
          version: '0.1.0',
          type: 'module',
          exports: './index.js',
          dependencies: { helper: 'workspace:*' },
        })
        await value.put(
          'libs/leaf/index.js',
          'import { readFileSync } from "node:fs"; import { token } from "helper"; export const marker = {}; export function getHelper() { return token }; export function readAsset() { return readFileSync(new URL("./asset.txt", import.meta.url), "utf8") }',
        )
        await value.put('libs/leaf/asset.txt', 'retained resource')
        await value.put('libs/side/package.json', {
          name: 'side',
          version: '0.1.0',
          type: 'module',
          exports: './index.js',
          dependencies: { leaf: 'workspace:*' },
        })
        await value.put('libs/side/index.js', 'export { marker } from "leaf"')
      }
      if (mode !== 'unlocked') {
        const child = Bun.spawn(
          [
            process.execPath,
            '--no-env-file',
            '--config=/dev/null',
            'install',
            '--lockfile-only',
            '--ignore-scripts',
          ],
          { cwd: value.root, env: {}, stdout: 'pipe', stderr: 'pipe' },
        )
        const [exit, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(exit, `${out}\n${err}`).toBe(0)
      }
      if (mode === 'stale')
        await value.put('libs/leaf/package.json', {
          name: 'leaf',
          version: '0.2.0',
          type: 'module',
          exports: './index.js',
        })
      if (mode === 'root-stale') {
        const lock = await readFile(join(value.root, 'bun.lock'), 'utf8')
        await value.put('bun.lock', lock.replace('root-app', 'old-root-app'))
      }
      if (mode === 'patch-stale') {
        const manifest = JSON.parse(await readFile(join(value.root, 'package.json'), 'utf8'))
        manifest.patchedDependencies['semver@6.3.1'] = 'patches/other.patch'
        await value.put('package.json', manifest)
        await value.put(
          'patches/other.patch',
          await readFile(join(value.root, 'patches/semver.patch'), 'utf8'),
        )
      }
      if (mode === 'patch-invalid')
        await value.put(
          'patches/semver.patch',
          [
            'diff --git a/does-not-exist.js b/does-not-exist.js',
            '--- a/does-not-exist.js',
            '+++ b/does-not-exist.js',
            '@@ -1 +1 @@',
            '-This source line does not exist in semver.',
            '+replacement',
            '',
          ].join('\n'),
        )
      captured = await value.capture()
      expect(captured).toBeDefined()
      const work = join(value.root, 'worker-work'),
        worker = join(value.root, 'worker.js')
      const build = await Bun.build({
        entrypoints: [join(import.meta.dir, '../src/internal/bun-native-preparation-worker.ts')],
        target: 'bun',
      })
      expect(build.success, JSON.stringify(build.logs)).toBeTrue()
      await writeFile(worker, (await build.outputs[0]!.text()).replaceAll('/work', work))
      await mkdir(work)
      const files = await Promise.all(
        captured!.captured.files
          .filter(({ path }) => mode !== 'patch-missing' || !path.endsWith('.patch'))
          .map(async ({ path }) => ({
            path,
            content: Buffer.from(await captured!.captured.read(path)).toString('base64'),
          })),
      )
      const child = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          worker,
          ...(mode === 'unlocked' ? ['--allow-resolution-network'] : []),
        ],
        { cwd: value.root, env: {}, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      )
      child.stdin.write(
        `${JSON.stringify({ type: 'source', files, workspace: { target: captured!.target, members: captured!.members, selected: captured!.selected } })}\n`,
      )
      child.stdin.end()
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(stderr).toBe('')
      const result = JSON.parse(stdout)
      if (mode === 'patch-invalid') {
        expect(exit).toBe(1)
        expect(result.type).toBe('failure')
        expect(result.code).toBe('PACKAGE_BUN_PREPARATION_FAILED')
        return
      }
      if (
        mode === 'stale' ||
        mode === 'root-stale' ||
        mode === 'patch-stale' ||
        mode === 'patch-missing'
      ) {
        expect(exit).toBe(1)
        expect(result.code).toBe(
          mode === 'patch-missing' ? 'PACKAGE_BUN_SOURCE_UNSUPPORTED' : 'PACKAGE_BUN_LOCK_STALE',
        )
        if (mode === 'root-stale') {
          expect(result.message).toContain('package.json: name')
          expect(result.location).toEqual({ path: 'package.json', pointer: '/name' })
        }
        if (mode === 'stale') expect(result.message).toContain('libs/leaf/package.json: version')
        return
      }
      expect(exit, stdout).toBe(0)
      expect(result.type).toBe('prepared')
      if (mode === 'patched') {
        for (const suffix of ['patches/semver.patch', 'node_modules/semver/jig-patch.js']) {
          const file = result.files.find(
            (file: { path: string }) => file.path === suffix || file.path.endsWith(`/${suffix}`),
          )
          expect(file, suffix).toBeDefined()
          expect(Buffer.from(file.content, 'base64').toString()).toContain('patched dependency')
        }
      }
      const prepared = join(value.root, 'prepared')
      for (const file of result.files) {
        expect(file.path).not.toContain('unrelated')
        await mkdir(dirname(join(prepared, file.path)), { recursive: true })
        await writeFile(join(prepared, file.path), Buffer.from(file.content, 'base64'))
      }
      const layout = normalizePrivateBunExecutionLayout(result.layout)
      expect(layout.flowRoot).toBe(rootApplication ? '' : target)
      if (mode === 'large')
        expect(
          Buffer.from(
            result.files.find(({ path }: { path: string }) => path === 'libs/leaf/large.txt')
              .content,
            'base64',
          ).byteLength,
        ).toBe(2 * 1024 * 1024)
      for (const alias of layout.aliases) {
        await mkdir(dirname(join(prepared, alias.path)), { recursive: true })
        await symlink(privatePackageAliasText(alias), join(prepared, alias.path))
      }
      await value.put('libs/leaf/index.js', 'throw new Error("live source must not run")')
      const run = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          ...(rootApplication
            ? ['-e', 'import { message } from "helper"; console.log(message)']
            : [`${layout.flowRoot}/FLOW.ts`]),
        ],
        { cwd: prepared, env: {}, stdout: 'pipe', stderr: 'pipe' },
      )
      const [runExit, output, error] = await Promise.all([
        run.exited,
        new Response(run.stdout).text(),
        new Response(run.stderr).text(),
      ])
      expect(runExit, error).toBe(0)
      expect(output).toBe(
        mode === 'versions' || mode === 'patched'
          ? '["6.3.1","7.7.2"]\n'
          : mode === 'topology'
            ? '{"same":true,"cyclic":true,"asset":"retained resource"}\n'
            : 'workspace bytes\n',
      )
      expect(await readFile(join(prepared, 'bun.lock'), 'utf8')).toContain('workspace:')
    } finally {
      await captured?.captured.dispose()
      await value.dispose()
    }
  },
  30_000,
)

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CheckError } from '../../src/diagnostics.js'
import { capturePrivateBunWorkspace } from '../../src/internal/bun-workspace-capture.js'
import { openPrivateWorkspaceSourceRoots } from '../../src/internal/workspace-source-roots.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import { openPrivateProjectRoot } from '../../src/project/root.js'

const [base, mode] = process.argv.slice(2)
assert(base)
assert(mode)
const workspace = join(base, 'workspace')
const helper = join(workspace, 'packages/helper')
const projectPath = join(workspace, 'apps/demo')
assert.equal(
  (await lstat(helper, { bigint: true })).dev,
  (await lstat(workspace, { bigint: true })).dev,
)

async function capture(root: string, sourceRoots: readonly string[] = []) {
  const project = await openPrivateProjectRoot(join(root, 'apps/demo'))
  let source: Awaited<ReturnType<typeof capturePackageDirectory>> | undefined
  let captured: Awaited<ReturnType<typeof capturePrivateBunWorkspace>>
  try {
    source = await capturePackageDirectory(join(root, 'apps/demo/flows/echo'))
    captured = await capturePrivateBunWorkspace({
      projectRoot: project,
      packagePath: 'flows/echo',
      captured: source,
      sourceRoots,
      signal: new AbortController().signal,
    })
    assert(captured, 'fixture must be an enclosing workspace member')
    return {
      workspace: captured,
      async dispose() {
        await captured!.captured.dispose()
        await source!.dispose()
        await project.dispose()
      },
    }
  } catch (error) {
    await captured?.captured.dispose()
    await source?.dispose()
    await project.dispose()
    throw error
  }
}

async function failure(roots: readonly string[], path: string) {
  await assert.rejects(capture(workspace, roots), (error: unknown) => {
    assert(error instanceof CheckError)
    assert.equal(error.code, 'PACKAGE_BUN_WORKSPACE_MOUNT')
    assert.equal(error.path, path)
    assert.match(error.message, /mount boundary/)
    assert(!error.message.includes(base!))
    return true
  })
}

if (mode === 'freshness') {
  const root = await openPrivateProjectRoot(workspace)
  const project = await openPrivateProjectRoot(projectPath)
  const selected = await openPrivateWorkspaceSourceRoots({
    workspaceRoot: root,
    projectRoot: project,
    sourceRoots: [helper],
  })
  try {
    await selected.verify()
    const mount = spawnSync('/usr/bin/mount', ['--no-mtab', '--bind', helper, helper], {
      encoding: 'utf8',
    })
    assert.deepEqual(
      { status: mount.status, stdout: mount.stdout, stderr: mount.stderr, error: mount.error },
      { status: 0, stdout: '', stderr: '', error: undefined },
    )
    try {
      await assert.rejects(selected.verify(), (error: unknown) => {
        assert(error instanceof CheckError)
        assert.equal(error.code, 'PACKAGE_BUN_WORKSPACE_CHANGED')
        return true
      })
    } finally {
      const unmount = spawnSync('/usr/bin/umount', ['--no-mtab', helper], { encoding: 'utf8' })
      assert.deepEqual(
        {
          status: unmount.status,
          stdout: unmount.stdout,
          stderr: unmount.stderr,
          error: unmount.error,
        },
        { status: 0, stdout: '', stderr: '', error: undefined },
      )
    }
  } finally {
    await selected.dispose()
    await project.dispose()
    await root.dispose()
  }
} else if (mode === 'protected' || mode === 'protected-folded' || mode === 'alias') {
  await assert.rejects(capture(workspace, [helper]), (error: unknown) => {
    assert(error instanceof CheckError)
    assert.equal(error.code, 'PACKAGE_BUN_SOURCE_ROOT_INVALID')
    if (mode === 'alias') assert.match(error.message, /must not alias/)
    assert(!error.message.includes(base!))
    return true
  })
} else if (mode === 'nested' || mode === 'file') {
  await failure([helper], `../../packages/helper/${mode === 'nested' ? 'data' : 'index.js'}`)
} else {
  const boundary = mode === 'prefix' ? 'packages' : 'packages/helper'
  await failure([], `../../${boundary}`)
  const control = await capture(join(base, 'control'))
  let admitted: Awaited<ReturnType<typeof capture>> | undefined
  try {
    admitted = await capture(workspace, [join(workspace, boundary)])
    assert.equal(admitted.workspace.captured.digest, control.workspace.captured.digest)
    assert.deepEqual(admitted.workspace.selected, control.workspace.selected)
    assert.deepEqual(admitted.workspace.members, control.workspace.members)
    assert.deepEqual(admitted.workspace.captured.files, control.workspace.captured.files)
    const paths = admitted.workspace.captured.files.map(({ path }) => path)
    assert(paths.includes('packages/unrelated/package.json'))
    assert(!paths.includes('packages/unrelated/private-note'))
    assert(!paths.some((path) => path.includes('node_modules')))
    assert(!paths.some((path) => path.split('/').some((part) => part.toLowerCase() === '.jig')))
    if (mode === 'prefix') {
      for (const path of [
        'packages/helper/.jig/admission-secret',
        'packages/helper/data/.JiG/run-secret',
      ])
        await assert.rejects(admitted.workspace.captured.read(path), {
          code: 'PACKAGE_FILE_MISSING',
        })
      const manifest = JSON.parse(await readFile(join(helper, 'package.json'), 'utf8'))
      await writeFile(
        join(helper, 'package.json'),
        JSON.stringify({ ...manifest, files: ['**/*', 'data/.JiG'] }),
      )
      await assert.rejects(capture(workspace, [join(workspace, boundary)]), {
        code: 'PACKAGE_BUN_WORKSPACE_INVALID',
      })
    }
    await writeFile(join(helper, 'index.js'), 'throw new Error("live helper must not run")\n')
    const prepared = join(base, 'prepared')
    for (const { path } of admitted.workspace.captured.files) {
      await mkdir(dirname(join(prepared, path)), { recursive: true })
      await writeFile(join(prepared, path), await admitted.workspace.captured.read(path))
    }
    assert.equal(
      await readFile(join(prepared, 'packages/helper/index.js'), 'utf8'),
      "export const message = 'synthetic helper'\n",
    )
    const install = Bun.spawn(
      [process.execPath, '--no-env-file', '--config=/dev/null', 'install', '--ignore-scripts'],
      { cwd: prepared, env: {}, stdout: 'pipe', stderr: 'pipe' },
    )
    const [installCode, installOut, installErr] = await Promise.all([
      install.exited,
      new Response(install.stdout).text(),
      new Response(install.stderr).text(),
    ])
    assert.equal(installCode, 0, `${installOut}\n${installErr}`)
    const run = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--no-install',
        '--config=/dev/null',
        'apps/demo/flows/echo/FLOW.ts',
      ],
      { cwd: prepared, env: {}, stdout: 'pipe', stderr: 'pipe' },
    )
    const [code, stdout, stderr] = await Promise.all([
      run.exited,
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ])
    assert.deepEqual(
      { code, stdout, stderr },
      { code: 0, stdout: '{"message":"synthetic helper"}\n', stderr: '' },
    )
  } finally {
    await admitted?.dispose()
    await control.dispose()
  }
}
console.log('workspace source roots verified')

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { capturePrivateBunWorkspace } from '../../src/internal/bun-workspace-capture.js'
import { openPrivateSourceChild } from '../../src/internal/descriptor-files.js'
import {
  captureOpenedPackageDirectory,
  capturePackageDirectory,
} from '../../src/package/capture.js'
import { discover } from '../../src/project/author.js'
import { captureAuthorModule } from '../../src/project/author-module.js'
import { captureDeclarationSource } from '../../src/project/declaration-source.js'
import { captureFlowSource } from '../../src/project/flow-source.js'
import { captureGrantSource } from '../../src/project/grant-source.js'
import { openPrivateProjectRoot } from '../../src/project/root.js'

const [projectPath, mode] = process.argv.slice(2)
assert(projectPath)
if (mode === 'tmpfs') {
  await writeFile(join(projectPath, 'mounted', 'jig.ts'), 'export default {};\n')
  await writeFile(join(projectPath, 'mounted', 'binding.ts'), 'export default {};\n')
  await writeFile(join(projectPath, 'mounted', 'policy.json'), '{}\n')
}
const root = await openPrivateProjectRoot(projectPath)
try {
  if (mode === 'freshness') {
    const source = await captureDeclarationSource(root, { kind: 'members', paths: ['binding.ts'] })
    const member = source.members[0]!
    assert.equal(new TextDecoder().decode(await source.read(member, 1024)), 'export default {};\n')
    await source.verify()
    const target = join(projectPath, 'binding.ts')
    const mount = spawnSync(
      '/usr/bin/mount',
      ['--no-mtab', '--bind', join(projectPath, '..', '.jig', 'binding.ts'), target],
      { encoding: 'utf8' },
    )
    assert.deepEqual(
      { status: mount.status, stdout: mount.stdout, stderr: mount.stderr, error: mount.error },
      { status: 0, stdout: '', stderr: '', error: undefined },
    )
    try {
      for (const operation of [() => source.read(member, 1024), () => source.verify()])
        await assert.rejects(operation(), (error: unknown) => {
          assert(error instanceof Error)
          assert.equal((error as Error & { code: string }).code, 'PROJECT_SOURCE_IO')
          assert.match(error.message, /mount boundary/)
          return true
        })
    } finally {
      const unmount = spawnSync('/usr/bin/umount', ['--no-mtab', target], { encoding: 'utf8' })
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
    await source.verify()
  } else {
    const mounted = await lstat(join(projectPath, mode === 'file' ? 'mounted.ts' : 'mounted'), {
      bigint: true,
    })
    if (mode === 'tmpfs') assert.notEqual(mounted.dev, root.information.dev)
    else assert.equal(mounted.dev, root.information.dev)
    const ordinary = await openPrivateSourceChild(root.handle, 'ordinary.ts', constants.O_RDONLY)
    try {
      assert.equal(await ordinary.readFile('utf8'), 'export default {};\n')
    } finally {
      await ordinary.close()
    }
    if (mode === 'file') {
      await assert.rejects(captureAuthorModule(projectPath, 'mounted.ts'), /mount boundary/)
      await assert.rejects(
        captureDeclarationSource(root, { kind: 'members', paths: ['mounted.ts'] }),
        /mount boundary/,
      )
      await assert.rejects(capturePackageDirectory(projectPath), /mount boundary/)
    } else {
      await assert.rejects(captureAuthorModule(projectPath, 'mounted/jig.ts'), /mount boundary/)
      await assert.rejects(
        captureDeclarationSource(root, { kind: 'members', paths: ['mounted/binding.ts'] }),
        /mount boundary/,
      )
      await assert.rejects(captureDeclarationSource(root, discover('mounted')), /mount boundary/)
      await assert.rejects(
        captureGrantSource(root, { kind: 'members', paths: ['mounted/policy.json'] }),
        /mount boundary/,
      )
      await assert.rejects(
        captureFlowSource(projectPath, { kind: 'members', paths: ['mounted'] }),
        /mount boundary/,
      )
      await assert.rejects(capturePackageDirectory(projectPath), /mount boundary/)
      const metadata = await captureOpenedPackageDirectory('workspace metadata', root.handle, {
        includes: (path) => path === 'package.json',
        maximumFiles: 1,
        maximumBytes: 1024,
      })
      try {
        await assert.rejects(
          capturePrivateBunWorkspace({
            projectRoot: root,
            packagePath: '.',
            captured: metadata,
            signal: new AbortController().signal,
          }),
          { code: 'PACKAGE_BUN_WORKSPACE_INVALID' },
        )
      } finally {
        await metadata.dispose()
      }
    }
    // A direct file open also refuses before the FileHandle adoption seam.
    const parent = await open(projectPath, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      await assert.rejects(
        openPrivateSourceChild(
          parent,
          mode === 'file' ? 'mounted.ts' : 'mounted',
          constants.O_RDONLY,
        ),
        { code: 'EXDEV' },
      )
    } finally {
      await parent.close()
    }
  }
} finally {
  await root.dispose()
}
console.log('mount boundaries refused')

import { chmod, mkdir, readFile, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  materializePrivatePackageLease,
  reacquirePrivatePackageMaterializationLease,
} from '../../src/internal/package-materialization.js'
import { capturePackageDirectory } from '../../src/package/capture.js'
import {
  normalizePrivateBunExecutionLayout,
  privateBunAliasText,
} from '../../src/internal/bun-execution-layout.js'

const mode = required('JIG_TEST_MODE')

if (mode === 'mkdir-before-open') {
  const allocation = parsed('JIG_TEST_ALLOCATION') as { readonly path: string }
  await mkdir(allocation.path, { mode: 0o700 })
  process.exit(71)
}

if (mode === 'complete-without-identity') {
  const allocation = parsed('JIG_TEST_ALLOCATION')
  const captured = await capturePackageDirectory(required('JIG_TEST_SOURCE'))
  await materializePrivatePackageLease(captured, allocation)
  // Deliberately retain both live objects: this is a coordinator crash, not a
  // graceful owner handoff.
  process.exit(72)
}

if (mode === 'partial-workspace-aliases') {
  const allocation = parsed('JIG_TEST_ALLOCATION') as { path: string; executionLayout: unknown }
  const layout = normalizePrivateBunExecutionLayout(allocation.executionLayout)
  const captured = await capturePackageDirectory(required('JIG_TEST_SOURCE'))
  const root = join(allocation.path, 'package')
  await mkdir(root, { recursive: true, mode: 0o700 })
  for (const file of captured.files) {
    const path = join(root, file.path)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, await captured.read(file.path), { mode: 0o444 })
  }
  const alias = layout.aliases[0]!
  await mkdir(dirname(join(root, alias.path)), { recursive: true, mode: 0o700 })
  await symlink(privateBunAliasText(alias), join(root, alias.path))
  process.exit(74)
}

if (mode === 'interrupt-alias-disposal') {
  const identity = parsed('JIG_TEST_IDENTITY') as {
    allocation: { path: string; executionLayout: unknown }
    package: { path: string }
  }
  const layout = normalizePrivateBunExecutionLayout(identity.allocation.executionLayout)
  const disposing = join(identity.allocation.path, 'package.disposing')
  await chmod(identity.allocation.path, 0o700)
  await rename(identity.package.path, disposing)
  const alias = join(disposing, layout.aliases[0]!.path)
  await chmod(dirname(alias), 0o700)
  await unlink(alias)
  process.exit(75)
}

if (mode === 'fresh-reacquire') {
  const protectedParent = required('JIG_TEST_PROTECTED_PARENT')
  const lease = await reacquirePrivatePackageMaterializationLease(
    protectedParent,
    parsed('JIG_TEST_IDENTITY'),
  )
  const value = await readFile(join(lease.root, 'nested/value.txt'), 'utf8')
  console.log(JSON.stringify({ value }))
  process.exit(0)
}

if (mode === 'interrupt-nested-disposal') {
  const identity = parsed('JIG_TEST_IDENTITY') as {
    readonly allocation: { readonly path: string }
    readonly package: { readonly path: string }
  }
  const transaction = identity.allocation.path
  const disposing = join(transaction, 'package.disposing')
  await chmod(transaction, 0o700)
  await rename(identity.package.path, disposing)
  const nested = join(disposing, 'nested')
  const removed = join(nested, 'removed')
  await chmod(disposing, 0o700)
  await chmod(nested, 0o700)
  await chmod(removed, 0o700)
  await unlink(join(removed, 'value.txt'))
  await rmdir(removed)
  process.exit(73)
}

throw new Error(`unknown package materialization crash mode ${mode}`)

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined) throw new Error(`missing ${name}`)
  return value
}

function parsed(name: string): unknown {
  return JSON.parse(required(name))
}

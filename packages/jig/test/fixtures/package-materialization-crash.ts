import { chmod, mkdir, readFile, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import {
  materializePrivatePackageLease,
  reacquirePrivatePackageMaterializationLease,
} from '../../src/internal/package-materialization.js'
import { capturePackageDirectory } from '../../src/package/capture.js'

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

import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeParentFlow, protectedOwnerRoot } from '../src/internal/invocation-context.js'

test('parent identity is exact, local, and distinct from a root operation', () => {
  const parent = {
    operationId: 'worker',
    target: { kind: 'binding', id: 'agent' },
    requestDigest: 'sha256:' + '1'.repeat(64),
    parent: null,
  }
  expect(normalizeParentFlow(null, undefined)).toBeNull()
  expect(normalizeParentFlow(parent, 'worker')).toEqual(parent)
  expect(Object.isFrozen(normalizeParentFlow(parent, 'worker'))).toBe(true)
  expect(() => normalizeParentFlow({ ...parent, operationId: 'worker\n' }, 'worker\n')).toThrow(
    'identity is invalid',
  )
  const nested = { ...parent, operationId: 'agent', parent }
  expect(normalizeParentFlow(nested, 'agent')).toEqual(nested)
  let ancestry = nested
  for (let i = 2; i < 5; i++) ancestry = { ...parent, operationId: `level-${i}`, parent: ancestry }
  expect(normalizeParentFlow(ancestry, ancestry.operationId)).toEqual(ancestry)
  expect(() => normalizeParentFlow({ ...parent, parent: ancestry }, 'worker')).toThrow(
    'fixed root resource budget',
  )
  for (const value of [parent, {}, undefined])
    expect(() => normalizeParentFlow(value, undefined)).toThrow()
  for (const value of [
    null,
    { ...parent, operationId: 'other' },
    { ...parent, requestDigest: 'forged' },
    { ...parent, extra: true },
    { ...parent, target: { kind: 'flow', path: '../escape' } },
    { ...parent, target: { kind: 'binding', id: 'bad/id' } },
    { ...parent, target: { kind: 'binding', id: 'agent', path: 'flows/agent' } },
  ])
    expect(() => normalizeParentFlow(value, 'worker')).toThrow()
})

test('the shared owner directory rejects exposed permissions and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-invocation-context-'))
  try {
    await mkdir(join(root, '.jig'))
    const owners = await protectedOwnerRoot(root)
    expect(await protectedOwnerRoot(root)).toBe(owners)
    await chmod(owners, 0o755)
    await expect(protectedOwnerRoot(root)).rejects.toThrow('not protected')
    await chmod(owners, 0o700)
    await rm(owners, { recursive: true })
    await mkdir(join(root, 'elsewhere'), { mode: 0o700 })
    await symlink(join(root, 'elsewhere'), owners)
    await expect(protectedOwnerRoot(root)).rejects.toThrow('not protected')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('HTTP and command ownership remain independent of the finite ACP controller', async () => {
  const source = await readFile(
    new URL('../src/internal/root-contained-effect-controller.ts', import.meta.url),
    'utf8',
  )
  expect(source).toContain("from './invocation-context.js'")
  expect(source).not.toContain("from './root-finite-acp-controller.js'")
  const context = await readFile(
    new URL('../src/internal/invocation-context.ts', import.meta.url),
    'utf8',
  )
  expect(context).not.toMatch(
    /from ['"].*(?:acp-agent-provider|finite-acp-controller|finite-acp-resource)/,
  )
})

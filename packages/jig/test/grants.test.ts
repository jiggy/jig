import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineBinding, defineJig, discover } from '../src/index.js'
import { captureGrantSource } from '../src/project/grant-source.js'
import { normalizeGrant } from '../src/project/grants.js'
import { openPrivateProjectRoot } from '../src/project/root.js'
import { resolveInvocationSlots } from '../src/project/invocation-slots.js'
import { linkPackageProject } from '../src/project/package-project.js'
import { HTTP_REQUEST_CONTRACT_DIGEST } from '../src/internal/private-http-request.js'
import { PROJECT_COMMAND_CONTRACT_DIGEST } from '../src/internal/private-project-command.js'
import { requiresAuthorityApproval, grantChanges } from '../src/internal/grant-review.js'

const http = {
  id: 'https://jig.md/contracts/http-request',
  version: '1.0.0',
  digest: HTTP_REQUEST_CONTRACT_DIGEST,
}
const command = {
  id: 'https://jig.md/contracts/project-command',
  version: '1.0.0',
  digest: PROJECT_COMMAND_CONTRACT_DIGEST,
}
const policy = normalizeGrant({ kind: 'http', url: 'https://example.org/', method: 'GET' })

test('one slot grammar supports inline policies and optional named reuse', () => {
  expect(defineJig({})).toEqual({})
  expect(defineJig({ grants: discover('./grants') }).grants).toEqual({
    kind: 'discover',
    roots: ['grants'],
  })
  const binding = defineBinding({
    package: 'flows/use',
    slots: { api: policy, tests: { kind: 'command', test: ['a.test.ts'] }, reused: 'grant:docs' },
  })
  expect(binding.slots.api).toEqual(policy)
  expect(binding.slots.reused).toBe('grant:docs')
  for (const value of [
    { kind: 'shell', run: 'sh' },
    { kind: 'command', run: 'x.ts', network: true },
    'grant:../secret',
    'grant:Bad',
  ])
    expect(() => defineBinding({ package: 'flows/use', slots: { api: value as never } })).toThrow()
})

test('grants require exact declared contracts and do not add native defaults or capacity', () => {
  const selected = { kind: 'grant' as const, policy }
  expect(resolveInvocationSlots({ api: http }, { api: selected }).api).toMatchObject({
    kind: 'native',
    native: 'http-request',
    grant: policy,
  })
  expect(() => resolveInvocationSlots({ api: http }, {})).toThrow()
  expect(() => resolveInvocationSlots({ api: command }, { api: selected })).toThrow()
  expect(() => resolveInvocationSlots({}, { api: selected })).toThrow()
  const uses = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['api' + i, http]))
  const slots = Object.fromEntries(Object.keys(uses).map((name) => [name, selected]))
  expect(() => resolveInvocationSlots(uses, slots)).toThrow('eight')
  delete uses.api8
  delete slots.api8
  expect(Object.keys(resolveInvocationSlots(uses, slots))).toHaveLength(8)
})

test('trusted linking rejects invalid URLs and schemas after inert authoring', () => {
  for (const declaration of [
    { kind: 'http', url: 'file:///etc/passwd', method: 'GET' },
    { kind: 'http', url: 'https://example.org/#fragment', method: 'GET' },
    { kind: 'http', url: 'https://example.org/', method: 'POST', bodySchema: { type: 'invalid' } },
  ]) {
    const binding = defineBinding({ package: 'flows/use', slots: { api: declaration as never } })
    expect(() =>
      resolveInvocationSlots(
        { api: http },
        {
          api: { kind: 'grant', policy: binding.slots.api as typeof policy },
        },
      ),
    ).toThrow()
  }
})

test('grant catalogs cannot execute accessors at the linker boundary', () => {
  let invoked = false
  const accessor = {
    enumerable: true,
    get() {
      invoked = true
      return {}
    },
  }
  expect(() =>
    linkPackageProject(Object.defineProperty({ flows: [], bindings: [] }, 'grants', accessor)),
  ).toThrow()
  expect(() =>
    linkPackageProject({
      flows: [],
      bindings: [],
      grants: Object.defineProperty({}, 'docs', accessor),
    }),
  ).toThrow()
  expect(invoked).toBe(false)
})

test('authority approval tracks the recipient and policy, not a filename pointer or source digest', () => {
  const lock = (value = policy, packagePath = 'flows/use', name = 'docs', source = 'first') => ({
    packages: { [packagePath]: { digest: source, directRun: false, uses: { api: http } } },
    bindings: {
      client: {
        packagePath,
        settings: {},
        slots: { api: { kind: 'grant' as const, name, policy: value } },
      },
    },
  })
  const first = lock()
  expect(requiresAuthorityApproval(null, first)).toBe(true)
  expect(requiresAuthorityApproval(first, lock(policy, 'flows/use', 'renamed', 'new code'))).toBe(
    false,
  )
  expect(requiresAuthorityApproval(first, lock(policy, 'flows/replaced'))).toBe(true)
  expect(
    requiresAuthorityApproval(
      first,
      lock(normalizeGrant({ kind: 'http', url: 'https://elsewhere.org/', method: 'GET' })),
    ),
  ).toBe(true)
  const cloned = { ...first, bindings: { ...first.bindings, attacker: first.bindings.client } }
  expect(requiresAuthorityApproval(first, cloned)).toBe(true)
  expect(grantChanges(first, cloned).map((c) => c.recipient)).toEqual(['binding:attacker/api'])
  expect(requiresAuthorityApproval(first, { ...first, bindings: {} })).toBe(false)
})

test('catalog capture is shallow, bounded, immutable, and rejects unsafe or ambiguous sources', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-grants-'))
  const root = await openPrivateProjectRoot(directory)
  try {
    await mkdir(join(directory, 'grants'))
    const file = join(directory, 'grants/docs.json')
    await writeFile(file, JSON.stringify(policy))
    const captured = await captureGrantSource(root, discover('grants'))
    expect(captured.grants.docs).toEqual(policy)
    await writeFile(file, JSON.stringify({ kind: 'command', run: 'other.ts' }))
    expect(captured.grants.docs).toEqual(policy)
    await expect(captured.verify()).rejects.toThrow()
    await mkdir(join(directory, 'other'))
    await writeFile(join(directory, 'other/docs.json'), JSON.stringify(policy))
    await expect(captureGrantSource(root, discover(['grants', 'other']))).rejects.toThrow(
      'declaration ID',
    )
    await symlink(file, join(directory, 'grants/linked.json'))
    await expect(captureGrantSource(root, discover('grants'))).rejects.toThrow('symlink')
    await rm(join(directory, 'grants/linked.json'))
    await writeFile(file, ' '.repeat(32769))
    await expect(captureGrantSource(root, discover('grants'))).rejects.toThrow('byte bound')
    await expect(
      captureGrantSource(root, { kind: 'members', paths: ['grants/missing.json'] }),
    ).rejects.toThrow('missing')
  } finally {
    await root.dispose()
    await rm(directory, { recursive: true, force: true })
  }
})

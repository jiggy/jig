import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizePrivateBunExecutionLayout } from '../src/internal/bun-execution-layout.js'
import { captureDependencyFlows, resolvePackageRoot } from '../src/internal/dependency-flows.js'
import { type CapturedPackage, createCapturedPackage } from '../src/package/capture.js'
import { defineBinding, defineJig, parseRunTargetSelector } from '../src/project/author.js'
import { openPrivateProjectRoot } from '../src/project/root.js'

const id = 'https://example.org/contracts/echo'

test('npm targets name declared packages, not registry versions, subpaths or JS exports', () => {
  expect(defineBinding({ package: 'npm:@example/echo' }).package).toBe('npm:@example/echo')
  expect(defineJig({ defaultProviders: { [id]: 'npm:@example/echo' } }).defaultProviders).toEqual({
    [id]: 'npm:@example/echo',
  })
  expect(parseRunTargetSelector('npm:echo', 'target')).toEqual({ kind: 'flow', path: 'npm:echo' })
  for (const target of [
    'npm:',
    'npm:../escape',
    'npm:echo@latest',
    'npm:echo/subpath',
    'npm:@example/echo/subpath',
    'flow:npm:echo',
  ])
    expect(() => parseRunTargetSelector(target, 'target')).toThrow()
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'jig-dependency-flows-'))
  const put = async (path: string, value: unknown) => {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(
      join(directory, path),
      typeof value === 'string' ? value : JSON.stringify(value),
    )
  }
  await put('package.json', { private: true, workspaces: ['apps/*', 'packages/*'] })
  await put('apps/consumer/package.json', {
    name: 'consumer',
    dependencies: { '@example/echo': 'workspace:*' },
  })
  await put('packages/echo/package.json', {
    name: '@example/echo',
    version: '1.0.0',
    files: ['FLOW.ts', 'FLOW.contract.json'],
  })
  await put('packages/echo/FLOW.ts', 'export {}' + '\n'.repeat(4096))
  await put('packages/echo/FLOW.contract.json', {
    $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
    id,
    version: '1.0.0',
  })
  const root = await openPrivateProjectRoot(join(directory, 'apps/consumer'))
  let preparations = 0
  const retained: string[] = []
  const capture = (selectors = ['npm:@example/echo'], signal = new AbortController().signal) =>
    captureDependencyFlows({
      root,
      selectors,
      signal,
      // Unit seam: snapshot and topology only. This is not installer or host evidence.
      prepare: async (source, workspace) => {
        preparations++
        expect(workspace?.target).toBe('apps/consumer')
        const bytes = new Map<string, Uint8Array>()
        for (const file of source.files) bytes.set(file.path, await source.read(file.path))
        const captured = createCapturedPackage('prepared fixture', source.files, source.digest, {
          async *stream(path, maximum) {
            yield bytes.get(path)!.subarray(0, maximum)
          },
          async dispose() {
            bytes.clear()
          },
        })
        return {
          captured,
          layout: normalizePrivateBunExecutionLayout({
            flowRoot: 'apps/consumer',
            members: ['apps/consumer', 'packages/echo'],
            aliases: [{ path: 'node_modules/@example/echo', target: 'packages/echo' }],
          }),
        }
      },
      retain: async (selector, source, execution) => {
        expect(selector).toBe('npm:@example/echo')
        expect(execution.layout.flowRoot).toBe('packages/echo')
        retained.push(source.digest)
      },
    })
  return {
    root,
    directory,
    put,
    capture,
    retained,
    preparations: () => preparations,
    async dispose() {
      await root.dispose()
      await rm(directory, { recursive: true, force: true })
    },
  }
}

test('workspace dependency supplies its own immutable Flow and contract without installed links', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.directory, 'apps/consumer/node_modules/@example'), { recursive: true })
    await symlink(
      '/missing/not-authority',
      join(f.directory, 'apps/consumer/node_modules/@example/echo'),
    )
    const first = await f.capture()
    try {
      const member = first.members[0]!
      expect(member.provenance.projectPath).toBe('npm:@example/echo')
      expect(member.inspected.contract?.descriptor.id).toBe(id)
      expect(member.captured.files.map((file) => file.path)).toEqual([
        'FLOW.contract.json',
        'FLOW.ts',
        'package.json',
      ])
      await f.put('packages/echo/FLOW.ts', 'export const changed = true')
      expect(new TextDecoder().decode(await member.captured.read('FLOW.ts'))).toBe(
        'export {}' + '\n'.repeat(4096),
      )
      const second = await f.capture()
      try {
        expect(second.members[0]!.captured.digest).not.toBe(member.captured.digest)
      } finally {
        await second.dispose()
      }
    } finally {
      await first.dispose()
    }
    expect(f.retained).toHaveLength(2)
  } finally {
    await f.dispose()
  }
})

test('missing declarations and symlinked source fail without acquiring package authority', async () => {
  const f = await fixture()
  try {
    await expect(f.capture(['npm:unrelated'])).rejects.toMatchObject({
      code: 'PROJECT_DEPENDENCY_MISSING',
    })
    expect(f.preparations()).toBe(0)
    await rm(join(f.directory, 'packages/echo/FLOW.ts'))
    await symlink('/etc/passwd', join(f.directory, 'packages/echo/FLOW.ts'))
    await expect(f.capture()).rejects.toMatchObject({ code: 'PACKAGE_BUN_WORKSPACE_INVALID' })
    expect(f.preparations()).toBe(0)
  } finally {
    await f.dispose()
  }
})

test('dependency capture respects cancellation and rejects a library without FLOW', async () => {
  const f = await fixture()
  try {
    const reason = new Error('cancel')
    await expect(f.capture(undefined, AbortSignal.abort(reason))).rejects.toBe(reason)
    await rm(join(f.directory, 'packages/echo/FLOW.ts'))
    await expect(f.capture()).rejects.toMatchObject({ code: 'PACKAGE_ENTRYPOINT_MISSING' })
    expect(f.retained).toHaveLength(0)
  } finally {
    await f.dispose()
  }
})

test('package lookup respects consumer dependency scope and cannot select missing contents', () => {
  const captured = {
    files: [
      { path: 'node_modules/echo/package.json' },
      { path: 'apps/app/node_modules/echo/package.json' },
    ],
  } as CapturedPackage
  const prepared = { captured, layout: { flowRoot: '', members: [], aliases: [] } }
  expect(resolvePackageRoot(prepared, 'apps/app', 'echo')).toBe('apps/app/node_modules/echo')
  expect(resolvePackageRoot(prepared, '', 'echo')).toBe('node_modules/echo')
  expect(() => resolvePackageRoot(prepared, '', 'missing')).toThrow()
})

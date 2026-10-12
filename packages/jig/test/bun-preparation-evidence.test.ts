import { describe, expect, test } from 'bun:test'
import {
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  normalizePrivateBunExecutionArtifact,
} from '../src/internal/bun-execution-layout.js'
import {
  assemblePrivateBunExecution,
  capturePrivateBunDependencies,
  privateBunPreparationInputs,
} from '../src/internal/bun-preparation-evidence.js'
import { type CapturedPackage, createCapturedPackage } from '../src/package/capture.js'
import { packageDigest } from '../src/package/digest.js'
import { comparePathBytes } from '../src/package/paths.js'

const supportDigest = `sha256:${'1'.repeat(64)}`
const workspace = {
  target: 'flows/main',
  members: ['flows/main', 'libs/helper', 'libs/unused'],
  selected: ['flows/main', 'libs/helper'],
}
const workspaceSource = {
  'package.json': JSON.stringify({ private: true, workspaces: ['flows/*', 'libs/*'] }),
  'bun.lock': 'locked bytes',
  'flows/main/package.json': JSON.stringify({
    name: 'main',
    dependencies: { helper: 'workspace:*' },
  }),
  'flows/main/FLOW.ts': 'first Flow source',
  'libs/helper/package.json': JSON.stringify({ name: 'helper', exports: './index.ts' }),
  'libs/helper/index.ts': 'first helper source',
  'libs/unused/package.json': JSON.stringify({ name: 'unused' }),
}

async function capture(values: Record<string, string>): Promise<CapturedPackage> {
  const contents = new Map(
    Object.entries(values).map(([path, text]) => [path, new TextEncoder().encode(text)]),
  )
  const files = [...contents]
    .map(([path, bytes]) => ({ path, size: bytes.byteLength }))
    .sort((a, b) => comparePathBytes(a.path, b.path))
  const backing = {
    stream: (path: string) =>
      (async function* () {
        yield contents.get(path)!
      })(),
    async dispose() {},
  }
  return createCapturedPackage(
    'test capture',
    files,
    await packageDigest(files, (file) => backing.stream(file.path)),
    backing,
  )
}

describe('private Bun dependency evidence', () => {
  test('source changes reuse installer identity; all native inputs and selection remain exact', async () => {
    const fingerprint = async (
      values = workspaceSource,
      selectedWorkspace = workspace,
      selectedSupport = supportDigest,
    ) =>
      privateBunPreparationInputs({
        captured: await capture(values),
        workspace: selectedWorkspace,
        supportDigest: selectedSupport,
      })
    const original = await fingerprint()
    const changed = await fingerprint({
      ...workspaceSource,
      'flows/main/FLOW.ts': 'changed',
      'libs/helper/index.ts': 'changed',
      'libs/helper/new.ts': 'added',
    })
    expect(changed.digest).toBe(original.digest)
    expect(changed.sourcePaths.has('libs/helper/new.ts')).toBeTrue()
    expect(changed.sourcePaths.has('libs/unused/package.json')).toBeFalse()
    for (const path of [
      'package.json',
      'bun.lock',
      'flows/main/package.json',
      'libs/helper/package.json',
      'libs/unused/package.json',
    ]) {
      const value =
        path === 'bun.lock'
          ? 'different lock'
          : JSON.stringify({ ...JSON.parse(workspaceSource[path]), description: 'changed' })
      expect((await fingerprint({ ...workspaceSource, [path]: value })).digest).not.toBe(
        original.digest,
      )
    }
    expect(
      (await fingerprint(workspaceSource, { ...workspace, target: 'libs/helper' })).digest,
    ).not.toBe(original.digest)
    expect(
      (await fingerprint(workspaceSource, { ...workspace, selected: ['flows/main'] })).digest,
    ).not.toBe(original.digest)
    expect(
      (await fingerprint(workspaceSource, workspace, `sha256:${'2'.repeat(64)}`)).digest,
    ).not.toBe(original.digest)
  })

  test('declared patches participate in identity and remain fresh source, not dependencies', async () => {
    const values = {
      ...workspaceSource,
      'package.json': JSON.stringify({
        private: true,
        workspaces: ['flows/*', 'libs/*'],
        patchedDependencies: { 'example@1.0.0': 'patches/example.patch' },
      }),
      'patches/example.patch': 'first patch',
    }
    const first = await privateBunPreparationInputs({
      captured: await capture(values),
      workspace,
      supportDigest,
    })
    const second = await privateBunPreparationInputs({
      captured: await capture({ ...values, 'patches/example.patch': 'second patch' }),
      workspace,
      supportDigest,
    })
    expect(first.digest).not.toBe(second.digest)
    expect(first.sourcePaths.has('patches/example.patch')).toBeTrue()
  })

  test('reassembly keeps installed bytes but replaces all source, including additions and deletions', async () => {
    const original = await capture({
      'package.json': '{"dependencies":{"example":"1.0.0"}}',
      'FLOW.ts': 'old',
      'removed.ts': 'old',
      'bun.lock': 'locked bytes',
    })
    const inputs = await privateBunPreparationInputs({ captured: original, supportDigest })
    const prepared = await capture({
      'package.json': '{"dependencies":{"example":"1.0.0"}}',
      'FLOW.ts': 'old',
      'removed.ts': 'old',
      'bun.lock': 'locked bytes',
      'node_modules/example/index.js': 'installed',
    })
    const dependencies = await capturePrivateBunDependencies(prepared, inputs.sourcePaths)
    expect(dependencies.files.map(({ path }) => path)).toEqual(['node_modules/example/index.js'])
    const fresh = await capture({
      'package.json': '{"dependencies":{"example":"1.0.0"}}',
      'FLOW.ts': 'new',
      'added.ts': 'new',
      'bun.lock': 'locked bytes',
    })
    const next = await privateBunPreparationInputs({ captured: fresh, supportDigest })
    expect(next.digest).toBe(inputs.digest)
    const assembled = await assemblePrivateBunExecution({
      source: fresh,
      sourcePaths: next.sourcePaths,
      dependencies,
      layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
    })
    expect(assembled.digest).not.toBe(prepared.digest)
    expect(assembled.files.some(({ path }) => path === 'removed.ts')).toBeFalse()
    expect(new TextDecoder().decode(await assembled.read('FLOW.ts'))).toBe('new')
    expect(new TextDecoder().decode(await assembled.read('node_modules/example/index.js'))).toBe(
      'installed',
    )
  })

  test('an approved generated lock survives unchanged unlocked inputs without becoming authored', async () => {
    const source = await capture({
      'package.json': '{"dependencies":{"example":"1.0.0"}}',
      'FLOW.ts': 'old',
    })
    const inputs = await privateBunPreparationInputs({ captured: source, supportDigest })
    const prepared = await capture({
      'package.json': '{"dependencies":{"example":"1.0.0"}}',
      'FLOW.ts': 'old',
      'bun.lock': 'resolved lock',
      'node_modules/example/index.js': 'installed',
    })
    const dependencies = await capturePrivateBunDependencies(prepared, inputs.sourcePaths)
    const assembled = await assemblePrivateBunExecution({
      source,
      sourcePaths: inputs.sourcePaths,
      dependencies,
      layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
    })
    expect(assembled.digest).toBe(prepared.digest)
    expect(
      (
        await privateBunPreparationInputs({
          captured: await capture({
            'package.json': '{"dependencies":{"example":"1.0.0"}}',
            'FLOW.ts': 'old',
            'bun.lock': 'resolved lock',
          }),
          supportDigest,
        })
      ).digest,
    ).not.toBe(inputs.digest)
  })

  test('refuses authored bytes in dependencies and fresh source collisions with installed paths', async () => {
    const source = await capture({
      'package.json': '{}',
      'FLOW.ts': 'new',
      node_modules: 'file collision',
    })
    const inputs = await privateBunPreparationInputs({ captured: source, supportDigest })
    await expect(
      capturePrivateBunDependencies(await capture({ 'FLOW.ts': 'stale' }), new Set()),
    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    await expect(
      assemblePrivateBunExecution({
        source,
        sourcePaths: inputs.sourcePaths,
        dependencies: await capture({ 'node_modules/example/index.js': 'installed' }),
        layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_SOURCE_UNSUPPORTED' })
  })

  test('evidence is immutable and rejects the superseded whole-source fingerprint', () => {
    const artifact = { kind: 'flow-package/0', digest: supportDigest }
    const value = {
      package: artifact,
      layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
      preparation: { inputDigest: supportDigest, package: artifact },
    }
    const result = normalizePrivateBunExecutionArtifact(value)
    expect(Object.isFrozen(result.preparation)).toBeTrue()
    expect(() =>
      normalizePrivateBunExecutionArtifact({
        package: artifact,
        layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
        preparationInputDigest: supportDigest,
      }),
    ).toThrow()
    expect(() =>
      normalizePrivateBunExecutionArtifact({
        ...value,
        preparation: { ...value.preparation, inputDigest: 'wrong' },
      }),
    ).toThrow()
  })
})

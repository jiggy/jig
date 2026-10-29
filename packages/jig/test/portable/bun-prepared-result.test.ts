import { expect, test } from 'bun:test'
import {
  link,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT } from '../../src/internal/bun-execution-layout.js'
import { decodePrivateBunPreparedResult } from '../../src/internal/bun-native-preparation.js'
import {
  PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARATION_LIMITS,
} from '../../src/internal/bun-native-preparation-protocol.js'
import { capturePrivateBunPreparationOutput } from '../../src/internal/bun-preparation-output.js'
import { type CapturedPackage, capturePackageDirectory } from '../../src/package/capture.js'

async function fixture(source: Record<string, string>, output = source) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-prepared-result-')))
  for (const [tree, files] of [
    ['source', source],
    ['work/prepared', output],
  ] as const)
    for (const [path, value] of Object.entries(files)) {
      await mkdir(dirname(join(root, tree, path)), { recursive: true })
      await writeFile(join(root, tree, path), value)
    }
  await mkdir(join(root, 'source'), { recursive: true })
  await mkdir(join(root, 'work/prepared'), { recursive: true })
  const captured = await capturePackageDirectory(join(root, 'source'))
  const work = await open(join(root, 'work'), 'r')
  return {
    root,
    captured,
    work,
    async close() {
      await work.close()
      await captured.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}
function metadata(captured: CapturedPackage, layout: unknown = EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT) {
  return {
    type: 'prepared',
    layout,
    fileCount: captured.files.length,
    bytes: captured.files.reduce((sum, file) => sum + file.size, 0),
    digest: captured.digest,
  }
}

test('preparation snapshot survives source and collector retirement', async () => {
  const value = await fixture(
    { 'package.json': '{}', 'FLOW.ts': 'export {}' },
    {
      'package.json': '{}',
      'FLOW.ts': 'export {}',
      'node_modules/dependency/empty': '',
      'node_modules/dependency/binary': '\0\u0001\u00ff',
    },
  )
  let prepared: CapturedPackage | undefined
  try {
    prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
    const result = await decodePrivateBunPreparedResult(prepared, metadata(prepared), {
      captured: value.captured,
    })
    await rename(join(value.root, 'work'), join(value.root, 'renamed'))
    await rm(join(value.root, 'renamed'), { recursive: true })
    expect(await result.captured.read('node_modules/dependency/empty')).toHaveLength(0)
    expect(Buffer.from(await result.captured.read('node_modules/dependency/binary'))).toEqual(
      Buffer.from('\0\u0001\u00ff'),
    )
  } finally {
    await prepared?.dispose()
    await value.close()
  }
})

for (const field of ['digest', 'bytes', 'fileCount', 'extra', 'layout'] as const)
  test(`preparation metadata refuses changed ${field}`, async () => {
    const value = await fixture({ 'package.json': '{}' })
    let prepared: CapturedPackage | undefined
    try {
      prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
      await expect(
        decodePrivateBunPreparedResult(
          prepared,
          { ...metadata(prepared), [field]: field === 'layout' ? {} : 'wrong' },
          { captured: value.captured },
        ),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await prepared?.dispose()
      await value.close()
    }
  })

for (const mode of ['changed', 'missing', 'extra'] as const)
  test(`preparation refuses ${mode} source`, async () => {
    const value = await fixture(
      { 'package.json': '{}', 'FLOW.ts': 'original' },
      mode === 'changed'
        ? { 'package.json': '{}', 'FLOW.ts': 'changed' }
        : mode === 'missing'
          ? { 'package.json': '{}' }
          : { 'package.json': '{}', 'FLOW.ts': 'original', 'unselected.ts': 'extra' },
    )
    let prepared: CapturedPackage | undefined
    try {
      prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
      await expect(
        decodePrivateBunPreparedResult(prepared, metadata(prepared), { captured: value.captured }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await prepared?.dispose()
      await value.close()
    }
  })

for (const kind of ['symlink', 'hardlink'] as const)
  test(`real preparation collector rejects ${kind}`, async () => {
    const value = await fixture({ 'package.json': '{}' })
    try {
      const target = join(value.root, 'work/prepared/package.json')
      if (kind === 'symlink') await symlink(target, join(dirname(target), 'alias'))
      else await link(target, join(dirname(target), 'alias'))
      await expect(capturePrivateBunPreparationOutput(value.work, 'production')).rejects.toThrow()
    } finally {
      await value.close()
    }
  })

test('preparation keeps 32MiB production and 128MiB evaluation decoded profiles', async () => {
  const value = await fixture({})
  let prepared: CapturedPackage | undefined
  try {
    await mkdir(join(value.root, 'work/prepared/node_modules/dependency'), { recursive: true })
    await writeFile(
      join(value.root, 'work/prepared/node_modules/dependency/content'),
      Buffer.alloc(PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes + 1, 0x78),
    )
    await expect(capturePrivateBunPreparationOutput(value.work, 'production')).rejects.toThrow()
    prepared = await capturePrivateBunPreparationOutput(value.work, 'evaluation')
    const result = await decodePrivateBunPreparedResult(prepared, metadata(prepared), {
      captured: value.captured,
      mode: 'evaluation',
    })
    expect(result.captured.files[0]?.size).toBe(PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes + 1)
    await prepared.dispose()
    const dependencyLimits = {
      maxPreparedFiles: PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles,
      maxPreparedBytes: PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes + 1024,
    }
    prepared = await capturePrivateBunPreparationOutput(value.work, 'production', dependencyLimits)
    await expect(
      decodePrivateBunPreparedResult(prepared, metadata(prepared), {
        captured: value.captured,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    expect(
      (
        await decodePrivateBunPreparedResult(prepared, metadata(prepared), {
          captured: value.captured,
          dependencyLimits,
        })
      ).captured.digest,
    ).toBe(prepared.digest)
    await expect(
      capturePrivateBunPreparationOutput(value.work, 'evaluation', dependencyLimits),
    ).rejects.toThrow('evaluation preparation limits are fixed')
  } finally {
    await prepared?.dispose()
    await value.close()
  }
})

test('prepared layout retains selected workspace aliases and exact patch bytes', async () => {
  const source = {
    'package.json': JSON.stringify({
      workspaces: ['flows/*', 'libs/*'],
      patchedDependencies: { 'dependency@1.0.0': 'patches/dependency.patch' },
    }),
    'bun.lock': 'retained',
    'patches/dependency.patch': 'patch',
    'flows/main/package.json': '{"name":"main"}',
    'flows/main/FLOW.ts': 'export {}',
    'libs/helper/package.json': '{"name":"helper"}',
    'libs/helper/index.ts': 'export {}',
    'libs/unselected/package.json': '{"name":"unselected"}',
  }
  const output = Object.fromEntries(
    Object.entries(source).filter(([path]) => !path.startsWith('libs/unselected')),
  )
  const value = await fixture(source, output)
  let prepared: CapturedPackage | undefined
  try {
    prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
    const workspace = { target: 'flows/main', selected: ['flows/main', 'libs/helper'] }
    const layout = {
      flowRoot: workspace.target,
      members: workspace.selected,
      aliases: [{ path: 'node_modules/helper', target: 'libs/helper' }],
    }
    expect(
      (
        await decodePrivateBunPreparedResult(prepared, metadata(prepared, layout), {
          captured: value.captured,
          workspace,
        })
      ).layout,
    ).toEqual(layout)
    for (const invalid of [
      { ...layout, flowRoot: 'libs/helper' },
      { ...layout, members: [...layout.members, 'libs/unselected'] },
      { ...layout, aliases: [{ path: 'node_modules/impostor', target: 'libs/helper' }] },
    ])
      await expect(
        decodePrivateBunPreparedResult(prepared, metadata(prepared, invalid), {
          captured: value.captured,
          workspace,
        }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
  } finally {
    await prepared?.dispose()
    await value.close()
  }
})

for (const mode of ['production', 'evaluation'] as const)
  test(`preparation ${mode} counts layout against its exact content ceiling`, async () => {
    const value = await fixture({})
    const limits =
      mode === 'production'
        ? PRIVATE_BUN_PREPARATION_LIMITS
        : PRIVATE_BUN_EVALUATION_PREPARATION_LIMITS
    let prepared: CapturedPackage | undefined
    try {
      const path = join(value.root, 'work/prepared/node_modules/dependency/content')
      await mkdir(dirname(path), { recursive: true })
      const file = await open(path, 'w')
      try {
        await file.truncate(limits.preparedBytes)
      } finally {
        await file.close()
      }
      prepared = await capturePrivateBunPreparationOutput(value.work, mode)
      await expect(
        decodePrivateBunPreparedResult(prepared, metadata(prepared), {
          captured: value.captured,
          mode,
        }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
      await prepared.dispose()
      prepared = undefined
      const oversized = await open(path, 'r+')
      try {
        await oversized.truncate(limits.preparedBytes + 1)
      } finally {
        await oversized.close()
      }
      await expect(capturePrivateBunPreparationOutput(value.work, mode)).rejects.toThrow()
    } finally {
      await prepared?.dispose()
      await value.close()
    }
  })

for (const alteration of ['missing', 'changed'] as const)
  test(`prepared workspace refuses ${alteration} patch`, async () => {
    const source = {
      'package.json': JSON.stringify({
        workspaces: ['flows/*'],
        patchedDependencies: { 'dependency@1.0.0': 'patches/dependency.patch' },
      }),
      'bun.lock': 'lock',
      'flows/main/package.json': '{"name":"main"}',
      'patches/dependency.patch': 'original',
    }
    const output: Record<string, string> = { ...source }
    if (alteration === 'missing') delete output['patches/dependency.patch']
    else output['patches/dependency.patch'] = 'changed'
    const value = await fixture(source, output)
    let prepared: CapturedPackage | undefined
    try {
      prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
      const workspace = { target: 'flows/main', selected: ['flows/main'] }
      await expect(
        decodePrivateBunPreparedResult(
          prepared,
          metadata(prepared, {
            flowRoot: workspace.target,
            members: workspace.selected,
            aliases: [],
          }),
          { captured: value.captured, workspace },
        ),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await prepared?.dispose()
      await value.close()
    }
  })

test('prepared aliases share the regular-file record ceiling', async () => {
  const output: Record<string, string> = {
    'package.json': '{"workspaces":["flows/*"]}',
    'bun.lock': 'lock',
    'flows/main/package.json': '{"name":"main"}',
  }
  for (let i = 3; i < PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles; i++)
    output[`node_modules/dependency/file-${i}`] = ''
  const value = await fixture(
    {
      'package.json': output['package.json']!,
      'bun.lock': 'lock',
      'flows/main/package.json': output['flows/main/package.json']!,
    },
    output,
  )
  let prepared: CapturedPackage | undefined
  try {
    prepared = await capturePrivateBunPreparationOutput(value.work, 'production')
    const workspace = { target: 'flows/main', selected: ['flows/main'] }
    await expect(
      decodePrivateBunPreparedResult(
        prepared,
        metadata(prepared, {
          flowRoot: workspace.target,
          members: workspace.selected,
          aliases: [{ path: 'node_modules/main', target: 'flows/main' }],
        }),
        { captured: value.captured, workspace },
      ),
    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
  } finally {
    await prepared?.dispose()
    await value.close()
  }
})

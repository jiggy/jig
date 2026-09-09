import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { PRIVATE_BUN_PREPARATION_LIMITS } from '../src/internal/bun-native-preparation-protocol.js'
import { capturePrivateBunPreparedTree } from '../src/internal/bun-prepared-capture.js'
import { privatePackageAliasText } from '../src/internal/package-aliases.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-prepared-capture-'))
  const put = async (path: string, value: unknown) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  const link = async (path: string, target: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await symlink(relative(dirname(join(root, path)), join(root, target)), join(root, path))
  }
  await put('package.json', { private: true, workspaces: ['flows/*', 'libs/*'] })
  await put('bun.lock', '{}')
  await put('flows/work/package.json', { name: 'work', type: 'module' })
  return { root, put, link, dispose: () => rm(root, { recursive: true, force: true }) }
}

async function execute(root: string, entrypoint = 'flows/work/flow.ts') {
  // These are fixed inert fixture modules, not externally supplied candidate code.
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', entrypoint],
    { cwd: root, env: {}, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exit, stderr).toBe(0)
  return JSON.parse(stdout)
}

async function restore(
  root: string,
  prepared: Awaited<ReturnType<typeof capturePrivateBunPreparedTree>>,
) {
  for (const file of prepared.files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true })
    await writeFile(join(root, file.path), Buffer.from(file.content, 'base64'))
  }
  for (const alias of prepared.layout.aliases) {
    await mkdir(dirname(join(root, alias.path)), { recursive: true })
    await symlink(privatePackageAliasText(alias), join(root, alias.path))
  }
}

test.each(['dep', '@scope/dep'])(
  'workspace preparation preserves the hoisted and Flow-local %s versions',
  async (name) => {
    const value = await fixture()
    try {
      await value.put(
        'flows/work/flow.ts',
        `import helper from "helper"; import dep from ${JSON.stringify(name)}; console.log(JSON.stringify([helper, dep]))`,
      )
      await value.put('node_modules/helper/package.json', {
        name: 'helper',
        type: 'module',
        main: 'index.js',
        dependencies: { [name]: '1.0.0' },
      })
      await value.put(
        'node_modules/helper/index.js',
        `import dep from ${JSON.stringify(name)}; export default dep`,
      )
      for (const [path, version] of [
        [`node_modules/${name}`, '1.0.0'],
        [`flows/work/node_modules/${name}`, '2.0.0'],
      ]) {
        await value.put(`${path}/package.json`, { name, version, type: 'module', main: 'index.js' })
        await value.put(`${path}/index.js`, `export default ${JSON.stringify(version)}`)
      }
      expect(await execute(value.root)).toEqual(['1.0.0', '2.0.0'])
      const prepared = await capturePrivateBunPreparedTree(value.root, {
        target: 'flows/work',
        members: ['flows/work'],
        selected: ['flows/work'],
      })
      const restored = join(value.root, 'restored')
      await restore(restored, prepared)
      expect(await execute(restored)).toEqual(['1.0.0', '2.0.0'])
    } finally {
      await value.dispose()
    }
  },
)

test.each(['flows/node_modules/dep', 'libs/node_modules/dep'])(
  'workspace preparation retains intermediate dependency scope %s',
  async (scope) => {
    const value = await fixture()
    try {
      await value.put('libs/helper/package.json', { name: 'helper' })
      await value.put(`${scope}/index.js`, 'intermediate dependency')
      const prepared = await capturePrivateBunPreparedTree(value.root, {
        target: 'flows/work',
        members: ['flows/work', 'libs/helper'],
        selected: ['flows/work', 'libs/helper'],
      })
      expect(prepared.files.find(({ path }) => path === `${scope}/index.js`)).toBeDefined()
    } finally {
      await value.dispose()
    }
  },
)

test('workspace aliases preserve singleton identity and cyclic dependency lookup', async () => {
  const value = await fixture()
  try {
    await value.put('libs/helper/package.json', {
      name: '@scope/helper',
      type: 'module',
      exports: './index.js',
    })
    await value.put('libs/leaf/package.json', {
      name: 'leaf',
      type: 'module',
      exports: './index.js',
    })
    await value.put(
      'libs/helper/index.js',
      'import { getHelper } from "leaf"; export const token = {}; export function cyclic() { return getHelper() === token }',
    )
    await value.put(
      'libs/leaf/index.js',
      'import { token } from "@scope/helper"; export function getHelper() { return token }',
    )
    await value.put(
      'flows/work/flow.ts',
      'import { token, cyclic } from "@scope/helper"; import { token as canonical } from "../../libs/helper/index.js"; console.log(JSON.stringify([token === canonical, cyclic()]))',
    )
    await value.link('node_modules/@scope/helper', 'libs/helper')
    await value.link('node_modules/leaf', 'libs/leaf')
    await value.link('flows/work/node_modules/@scope/helper', 'libs/helper')
    await value.put('libs/unrelated/package.json', { name: 'unrelated' })
    await value.put('libs/unrelated/private.txt', 'not selected')
    await value.link('node_modules/unrelated', 'libs/unrelated')
    expect(await execute(value.root)).toEqual([true, true])
    const prepared = await capturePrivateBunPreparedTree(value.root, {
      target: 'flows/work',
      members: ['flows/work', 'libs/helper', 'libs/leaf', 'libs/unrelated'],
      selected: ['flows/work', 'libs/helper', 'libs/leaf'],
    })
    expect(prepared.layout.aliases).toHaveLength(3)
    expect(prepared.files.some(({ path }) => path.includes('unrelated'))).toBeFalse()
    expect(
      prepared.files.some(({ path }) => path.startsWith('node_modules/@scope/helper/')),
    ).toBeFalse()
    const restored = join(value.root, 'restored')
    await restore(restored, prepared)
    expect(await execute(restored)).toEqual([true, true])
  } finally {
    await value.dispose()
  }
})

test.each(['outside', 'name', 'source-position', 'dependency-file'])(
  'workspace preparation rejects unauthorized %s alias',
  async (mode) => {
    const value = await fixture()
    try {
      await value.put('libs/helper/package.json', { name: 'helper' })
      if (mode === 'outside') {
        await mkdir(join(value.root, 'node_modules'))
        await symlink('/etc', join(value.root, 'node_modules/helper'))
      } else
        await value.link(
          mode === 'name'
            ? 'node_modules/forged'
            : mode === 'source-position'
              ? 'flows/work/helper'
              : 'node_modules/container/helper.js',
          'libs/helper',
        )
      await expect(
        capturePrivateBunPreparedTree(value.root, {
          target: 'flows/work',
          members: ['flows/work', 'libs/helper'],
          selected: ['flows/work', 'libs/helper'],
        }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_OUTPUT_UNSUPPORTED' })
    } finally {
      await value.dispose()
    }
  },
)

test('ordinary preparation keeps its existing root layout and rejects links', async () => {
  const value = await fixture()
  try {
    const prepared = await capturePrivateBunPreparedTree(value.root)
    expect(prepared.layout).toEqual({ flowRoot: '', members: [], aliases: [] })
    expect(prepared.files.map(({ path }) => path)).toContain('flows/work/package.json')
    await value.link('node_modules/work', 'flows/work')
    await expect(capturePrivateBunPreparedTree(value.root)).rejects.toMatchObject({
      code: 'PACKAGE_BUN_OUTPUT_UNSUPPORTED',
    })
  } finally {
    await value.dispose()
  }
})

test('workspace aliases share the bounded prepared-file budget', async () => {
  const value = await fixture()
  try {
    await value.put('libs/helper/package.json', { name: 'helper' })
    // Four existing regular files plus these records exhaust the file budget.
    for (let start = 0; start < PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles - 4; start += 64) {
      const end = Math.min(start + 64, PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles - 4)
      await Promise.all(
        Array.from({ length: end - start }, (_, offset) =>
          value.put(`flows/work/record-${start + offset}`, ''),
        ),
      )
    }
    await value.link('node_modules/helper', 'libs/helper')
    await expect(
      capturePrivateBunPreparedTree(value.root, {
        target: 'flows/work',
        members: ['flows/work', 'libs/helper'],
        selected: ['flows/work', 'libs/helper'],
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_BUN_OUTPUT_LIMIT' })
  } finally {
    await value.dispose()
  }
})

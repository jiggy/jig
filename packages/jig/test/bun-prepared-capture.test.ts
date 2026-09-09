import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { capturePrivateBunPreparedTree } from '../src/internal/bun-prepared-capture.js'

test.each(['dep', '@scope/dep'])(
  'workspace preparation rejects shadowing the hoisted %s version',
  async (name) => {
    const root = await mkdtemp(join(tmpdir(), 'jig-prepared-capture-'))
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
    }
    const execute = async (cwd: string) => {
      // Only the fixed inert modules authored below execute, never candidate code.
      const child = Bun.spawn(
        [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', 'flow.ts'],
        {
          cwd,
          env: {},
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(exit, stderr).toBe(0)
      return JSON.parse(stdout)
    }
    try {
      await put('bun.lock', '{}')
      await put('flows/work/package.json', { name: 'work', type: 'module' })
      await put(
        'flows/work/flow.ts',
        `import helper from "helper"; import dep from ${JSON.stringify(name)}; console.log(JSON.stringify([helper, dep]))`,
      )
      await put('node_modules/helper/package.json', {
        name: 'helper',
        type: 'module',
        main: 'index.js',
        dependencies: { [name]: '1.0.0' },
      })
      await put(
        'node_modules/helper/index.js',
        `import dep from ${JSON.stringify(name)}; export default dep`,
      )
      for (const [path, version] of [
        [`node_modules/${name}`, '1.0.0'],
        [`flows/work/node_modules/${name}`, '2.0.0'],
      ]) {
        await put(`${path}/package.json`, { name, version, type: 'module', main: 'index.js' })
        await put(`${path}/index.js`, `export default ${JSON.stringify(version)}`)
      }
      const before = await execute(join(root, 'flows/work'))
      expect(before).toEqual(['1.0.0', '2.0.0'])
      await expect(
        capturePrivateBunPreparedTree(root, {
          target: 'flows/work',
          members: ['flows/work'],
          selected: ['flows/work'],
        }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_WORKSPACE_LAYOUT_UNSUPPORTED' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test.each(['flows/node_modules/dep', 'libs/node_modules/dep'])(
  'workspace preparation rejects dropping intermediate scope %s',
  async (scope) => {
    const root = await mkdtemp(join(tmpdir(), 'jig-prepared-scope-'))
    try {
      await mkdir(join(root, scope), { recursive: true })
      await expect(
        capturePrivateBunPreparedTree(root, {
          target: 'flows/work',
          members: ['flows/work', 'libs/helper'],
          selected: ['flows/work', 'libs/helper'],
        }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_WORKSPACE_LAYOUT_UNSUPPORTED' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test('disjoint Flow-local and hoisted dependencies are retained without substitution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-prepared-disjoint-'))
  try {
    const authored = {
      'flows/work/flow.ts': 'flow source',
      'flows/work/node_modules/local/index.js': 'local source',
      'node_modules/hoisted/index.js': 'hoisted source',
      'bun.lock': 'lock bytes',
    }
    for (const [path, bytes] of Object.entries(authored)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), bytes)
    }
    const captured = await capturePrivateBunPreparedTree(root, {
      target: 'flows/work',
      members: ['flows/work'],
      selected: ['flows/work'],
    })
    expect(
      Object.fromEntries(
        captured.map(({ path, content }) => [path, Buffer.from(content, 'base64').toString()]),
      ),
    ).toEqual({
      'flow.ts': 'flow source',
      'node_modules/local/index.js': 'local source',
      'node_modules/hoisted/index.js': 'hoisted source',
      'bun.lock': 'lock bytes',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

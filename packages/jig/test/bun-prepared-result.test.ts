import { describe, expect, test } from 'bun:test'
import {
  EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
  type PrivateBunExecutionLayout,
} from '../src/internal/bun-execution-layout.js'
import { decodePrivateBunPreparedResult } from '../src/internal/bun-native-preparation.js'
import { PRIVATE_BUN_PREPARATION_LIMITS } from '../src/internal/bun-native-preparation-protocol.js'
import { createCapturedPackage, type CapturedPackage } from '../src/package/capture.js'
import { packageDigest } from '../src/package/digest.js'
import { comparePathBytes } from '../src/package/paths.js'

const ordinarySource = { 'flow.ts': 'export {}\n', 'package.json': '{"name":"ordinary"}' }
const workspaceSource = {
  'package.json': '{"private":true,"workspaces":["flows/*","libs/*"]}',
  'bun.lock': 'retained lock bytes',
  'flows/main/package.json': '{"name":"main","dependencies":{"helper":"workspace:*"}}',
  'flows/main/flow.ts': 'import "helper"\n',
  'libs/helper/package.json': '{"name":"helper","exports":"./index.ts"}',
  'libs/helper/index.ts': 'export const value = 42\n',
  'libs/unselected/package.json': '{"name":"unselected"}',
}
const workspace = { target: 'flows/main', selected: ['flows/main', 'libs/helper'] }
const workspaceLayout: PrivateBunExecutionLayout = {
  flowRoot: workspace.target,
  members: workspace.selected,
  aliases: [{ path: 'node_modules/helper', target: 'libs/helper' }],
}

describe('private prepared Bun result decoder', () => {
  test('retains exact ordinary source and installed bytes with an empty layout', async () => {
    const captured = await source(ordinarySource)
    try {
      const result = await decodePrivateBunPreparedResult(
        records({
          ...ordinarySource,
          'bun.lock': 'generated lock',
          'node_modules/dependency/index.js': 'export default 42',
        }),
        EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
        { captured },
      )
      try {
        expect(result.layout).toEqual(EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT)
        expect(await result.captured.read('flow.ts')).toEqual(
          Buffer.from(ordinarySource['flow.ts']),
        )
        expect(await result.captured.read('node_modules/dependency/index.js')).toEqual(
          Buffer.from('export default 42'),
        )
      } finally {
        await result.captured.dispose()
      }
    } finally {
      await captured.dispose()
    }
  })

  test('retains selected workspace source and aliases without unselected source', async () => {
    const captured = await source(workspaceSource)
    try {
      const result = await decodePrivateBunPreparedResult(workspaceRecords(), workspaceLayout, {
        captured,
        workspace,
      })
      try {
        expect(result.layout).toEqual(workspaceLayout)
        expect(result.captured.files.some(({ path }) => path.includes('unselected'))).toBeFalse()
        expect(result.captured.files.some(({ path }) => path === 'node_modules/helper')).toBeFalse()
        expect(await result.captured.read('libs/helper/index.ts')).toEqual(
          Buffer.from(workspaceSource['libs/helper/index.ts']),
        )
      } finally {
        await result.captured.dispose()
      }
    } finally {
      await captured.dispose()
    }
  })

  test.each(['changed', 'missing'] as const)('rejects %s authored source', async (mode) => {
    const captured = await source(ordinarySource)
    try {
      const files =
        mode === 'changed'
          ? records({ ...ordinarySource, 'flow.ts': 'changed source' })
          : records({ 'package.json': ordinarySource['package.json'] })
      await expect(
        decodePrivateBunPreparedResult(files, EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT, { captured }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await captured.dispose()
    }
  })

  test.each(['member', 'flowRoot', 'aliasName', 'extraSource'] as const)(
    'rejects a worker-selected workspace expansion: %s',
    async (mode) => {
      const captured = await source(workspaceSource)
      try {
        const layout =
          mode === 'member'
            ? { ...workspaceLayout, members: [...workspaceLayout.members, 'libs/unselected'] }
            : mode === 'flowRoot'
              ? { ...workspaceLayout, flowRoot: 'libs/helper' }
              : mode === 'aliasName'
                ? {
                    ...workspaceLayout,
                    aliases: [{ path: 'node_modules/impostor', target: 'libs/helper' }],
                  }
                : workspaceLayout
        const files =
          mode === 'extraSource'
            ? [
                ...workspaceRecords(),
                ...records({ 'libs/unselected/source.ts': 'unreviewed bytes' }),
              ].sort((left, right) => comparePathBytes(left.path, right.path))
            : workspaceRecords()
        await expect(
          decodePrivateBunPreparedResult(files, layout, { captured, workspace }),
        ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
      } finally {
        await captured.dispose()
      }
    },
  )

  test.each(['missingLayout', 'layoutField', 'fileField', 'aliasField'] as const)(
    'rejects missing or unknown protocol fields: %s',
    async (mode) => {
      const captured = await source(workspaceSource)
      try {
        const layout =
          mode === 'missingLayout'
            ? undefined
            : mode === 'layoutField'
              ? { ...workspaceLayout, extra: true }
              : mode === 'aliasField'
                ? { ...workspaceLayout, aliases: [{ ...workspaceLayout.aliases[0], extra: true }] }
                : workspaceLayout
        const files = workspaceRecords().map((file, index) =>
          mode === 'fileField' && index === 0 ? { ...file, extra: true } : file,
        )
        await expect(
          decodePrivateBunPreparedResult(files, layout, { captured, workspace }),
        ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
      } finally {
        await captured.dispose()
      }
    },
  )

  test('counts aliases and regular files against the same prepared record ceiling', async () => {
    const captured = await source(workspaceSource)
    try {
      const files = Array.from({ length: PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles }, () => ({
        path: 'unused',
        content: '',
      }))
      await expect(
        decodePrivateBunPreparedResult(files, workspaceLayout, { captured, workspace }),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await captured.dispose()
    }
  })

  test('accepts a large valid file and counts layout bytes against the content ceiling', async () => {
    const captured = await source({})
    try {
      const layoutBytes = Buffer.byteLength(JSON.stringify(EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT))
      const maximum = PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes - layoutBytes
      const allowed = await decodePrivateBunPreparedResult(
        records({
          'node_modules/dependency/content': 'x'.repeat(maximum),
        }),
        EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
        { captured },
      )
      try {
        expect(allowed.captured.files[0]!.size).toBe(maximum)
      } finally {
        await allowed.captured.dispose()
      }
      await expect(
        decodePrivateBunPreparedResult(
          records({
            'node_modules/dependency/content': 'x'.repeat(maximum + 1),
          }),
          EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
          { captured },
        ),
      ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
    } finally {
      await captured.dispose()
    }
  })

  test.each(['eB==', 'eA', 'eA==\n', '!!!!'])(
    'rejects noncanonical prepared base64: %j',
    async (content) => {
      const captured = await source({})
      try {
        await expect(
          decodePrivateBunPreparedResult(
            [{ path: 'node_modules/dependency/content', content }],
            EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
            { captured },
          ),
        ).rejects.toMatchObject({ code: 'PACKAGE_BUN_PROTOCOL' })
      } finally {
        await captured.dispose()
      }
    },
  )
})

function records(files: Record<string, string>) {
  return Object.entries(files)
    .sort(([left], [right]) => comparePathBytes(left, right))
    .map(([path, content]) => ({ path, content: Buffer.from(content).toString('base64') }))
}

function workspaceRecords() {
  return records(
    Object.fromEntries(
      Object.entries(workspaceSource).filter(([path]) => !path.startsWith('libs/unselected/')),
    ),
  )
}

async function source(files: Record<string, string>): Promise<CapturedPackage> {
  const values = new Map(
    Object.entries(files).map(([path, content]) => [path, Buffer.from(content)]),
  )
  const entries = [...values]
    .sort(([left], [right]) => comparePathBytes(left, right))
    .map(([path, content]) => ({ path, size: content.byteLength }))
  const backing = {
    async *stream(path: string) {
      const value = values.get(path)
      if (value === undefined) throw new Error('missing test source')
      yield value
    },
    async dispose() {
      values.clear()
    },
  }
  return createCapturedPackage(
    'inert prepared-result fixture',
    entries,
    await packageDigest(entries, (file) => backing.stream(file.path)),
    backing,
  )
}

import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPackageDirectory } from '../../src/package/inspect.js'
import {
  invokeFailure,
  writeAgentFreeProject,
  writeAgentRouterProject,
  writeBoundResourceProject,
  writeBroadcastChannelProject,
  writeChannelConversationProject,
  writeChannelProject,
  writeChildChannelProject,
  writeProject,
} from '.././private-foreground.fixture.js'

describe('private foreground command boundary', () => {
  test('constructs current package declarations and parseable code for every contained fixture', async () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
    for (const construct of [
      writeProject,
      writeAgentFreeProject,
      writeAgentRouterProject,
      writeChannelProject,
      writeChildChannelProject,
      writeBroadcastChannelProject,
      writeBoundResourceProject,
    ]) {
      const root = await mkdtemp(join(tmpdir(), 'jig-foreground-fixture-'))
      try {
        await construct(root)
        for (const name of await readdir(join(root, 'flows'))) {
          const directory = join(root, 'flows', name)
          const inspected = await checkPackageDirectory(directory)
          expect(inspected.entrypoint).toMatchObject({ path: 'FLOW.ts', suffix: 'ts' })
          const source = await readFile(join(directory, 'FLOW.ts'), 'utf8')
          expect(() => transpiler.transformSync(source)).not.toThrow()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
  test('requires explicit approval separately from a reviewed Plan', async () => {
    const failure = await invokeFailure(['apply', '.', '--plan', `sha256:${'0'.repeat(64)}`])
    expect(failure).toContain('apply requires explicit --yes approval')
  })
  test('constructs every named conversation peer', async () => {
    for (const peer of [
      'normal',
      'fahrenheit',
      'duplicate',
      'unexpected',
      'eof',
      'held',
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), 'jig-conversation-fixture-'))
      try {
        await writeChannelConversationProject(root, peer)
        for (const name of ['investigate', 'analysis', 'dataset']) {
          const built = await Bun.build({
            entrypoints: [join(root, 'flows', name, 'FLOW.ts')],
            target: 'bun',
          })
          expect(built.success, String(built.logs)).toBeTrue()
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
  test('does not combine admission and root execution', async () => {
    expect(await invokeFailure(['run', '.', '--request'])).toContain('--request requires a value')
    expect(await invokeFailure(['apply-run'])).toContain('usage: private-foreground')
  })
})

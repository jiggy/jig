import { describe, expect, test } from 'bun:test'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPackageDirectory } from '../../src/package/inspect.js'
import { flowSdkRuntimeDirectory } from '../fixtures/flow-dependency.js'
import {
  firstLine,
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
  test('executes generated worker and child through the complete unchanged public SDK', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-foreground-sdk-'))
    try {
      await writeProject(root)
      const sdk = flowSdkRuntimeDirectory
      const files = (await readdir(sdk, { recursive: true })).sort()
      for (const [name, held] of [
        ['worker', false],
        ['handle-bug', false],
        ['handle-bug', true],
      ] as const) {
        const directory = join(root, 'flows', name)
        const copied = join(directory, 'flow-sdk')
        expect((await readdir(copied, { recursive: true })).sort()).toEqual(files)
        for (const file of files) {
          if ((await lstat(join(sdk, file))).isFile())
            expect(await readFile(join(copied, file))).toEqual(await readFile(join(sdk, file)))
        }
        const scratch = join(root, `${name}-${held}-scratch`)
        await mkdir(scratch)
        const input = {
          kind: 'bug',
          ticket: 'copied-sdk-imports',
          ...(held ? { holdUntilSignal: true } : {}),
        }
        const child = Bun.spawn([process.execPath, join(directory, 'FLOW.ts')], {
          cwd: directory,
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          timeout: 5_000,
        })
        const [readiness, diagnostics] = held ? child.stderr.tee() : [undefined, child.stderr]
        try {
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 'sdk-imports',
              method: 'flow/run',
              params: {
                protocol: 'run/0',
                input,
                settings: {},
                attachments: {},
                scratch,
                deadlineUnixMs: Date.now() + 5_000,
              },
            })}\n`,
          )
          await child.stdin.flush()
          if (held) {
            expect(await firstLine(readiness!)).toBe('held-child-ready')
            expect(child.exitCode).toBeNull()
            // Use platform signal numbering, as the native held-child case does.
            process.kill(child.pid, 'SIGUSR1')
          }
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(child.stdout).text(),
            new Response(diagnostics).text(),
            child.exited,
          ])
          expect(stderr).toBe(held ? 'held-child-ready\n' : '')
          expect(exitCode).toBe(0)
          expect(JSON.parse(stdout)).toMatchObject({
            jsonrpc: '2.0',
            id: 'sdk-imports',
            result: {
              outcome: 'done',
              output:
                name === 'worker'
                  ? { worker: input }
                  : {
                      handled: 'bug',
                      ticket: input.ticket,
                      parentMarkerVisible: false,
                    },
            },
          })
        } finally {
          child.kill('SIGKILL')
          await child.exited
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
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

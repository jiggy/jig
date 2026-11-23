import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPrivateSavedCalls } from '../../src/internal/saved-call-evidence.js'
import { canonicalJson, JSON_1_LIMITS, type JsonValue, validateJson1 } from '../../src/json.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import {
  foundationCommands,
  foundationEnvironment,
  foundationResidue,
  freezeFoundationArchives,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()
const childCalls = 2

function nodes(value: JsonValue): number {
  if (value === null || typeof value !== 'object') return 1
  return 1 + Object.values(value).reduce((sum: number, child) => sum + nodes(child), 0)
}

test('installed record-calls discloses omitted evidence when the ordinary result fills the JSON frame', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-installed-call-evidence-')))
  let passed = false
  try {
    const command = foundationCommands(join(root, 'commands'))
    const archives = await freezeFoundationArchives(root, command)
    const tooling = join(root, 'tooling')
    await mkdir(tooling)
    await writeFile(
      join(tooling, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: {
          '@jigging/jig': `file:${archives.jig}`,
          '@jigging/flow': `file:${archives.flow}`,
        },
      }),
    )
    await command(
      [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
      tooling,
      120_000,
    )
    const cli = join(tooling, 'node_modules/.bin/jig')
    const project = join(root, 'project')
    const before = await foundationResidue(qualification, command, root)
    await command([cli, 'init', project], root)
    await writeFile(
      join(project, 'jig.ts'),
      `import { defineJig, discover } from '@jigging/jig'
export default defineJig({ flows: discover('flows'), bindings: discover('bindings'), entrypoint: 'binding:app' })
`,
    )
    await writeFile(
      join(project, 'bindings/app.ts'),
      `import { defineBinding } from '@jigging/jig'
export default defineBinding({ package: 'flows/hello', slots: { worker: 'flow:flows/worker' } })
`,
    )
    await writeFile(
      join(project, 'flows/hello/FLOW.meta.json'),
      JSON.stringify({ name: 'hello', uses: { worker: {} } }),
    )
    await writeFile(
      join(project, 'flows/hello/FLOW.ts'),
      `import { handle } from '@jigging/flow'
await handle(async run => {
  for (let index = 0; index < ${childCalls}; index++) {
    const child = await run.call({ slot: 'worker', operationId: 'work-' + index, input: null })
    if (child.outcome !== 'done' || child.output !== null) throw Error('Unexpected child result')
  }
  const count = run.input
  const width = ${JSON_1_LIMITS.containerEntries}
  return { outcome: 'done', output: Array.from({ length: 4 }, (_, index) =>
    Array(Math.min(width, Math.max(0, count - index * width))).fill(0)) }
})
`,
    )
    await mkdir(join(project, 'flows/worker'))
    await writeFile(
      join(project, 'flows/worker/package.json'),
      await readFile(join(project, 'flows/hello/package.json')),
    )
    await writeFile(join(project, 'flows/worker/FLOW.meta.json'), '{"name":"worker"}\n')
    await writeFile(
      join(project, 'flows/worker/FLOW.ts'),
      `import { handle } from '@jigging/flow'
await handle(async () => {
  console.error('Child completed')
  return { outcome: 'done', output: null }
})
`,
    )
    await command([cli, 'review', '--yes', '--allow-resolution-network'], project)
    const lock = await readFile(join(project, 'jig.lock'))
    let sequence = 0
    const run = async (count: number, recordCalls: boolean) => {
      const child = Bun.spawn(
        [
          cli,
          'run',
          '--input',
          String(count),
          '--timeout',
          '2m',
          '--json',
          ...(recordCalls ? ['--record-calls'] : []),
        ],
        {
          cwd: project,
          env: foundationEnvironment(),
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      return settleTestCommand(child, {
        evidence: join(root, `run-${++sequence}`),
        timeoutMs: 195_000,
        stdoutLimit: JSON_1_LIMITS.bytes + 1,
      })
    }
    const small = await run(0, false)
    expect(small.code, small.stderr).toBe(0)
    const ordinary = JSON.parse(small.stdout)
    expect(ordinary).toMatchObject({
      status: 'succeeded',
      outcome: 'done',
      output: [[], [], [], []],
      diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
      runDiagnostics: { truncated: false },
    })
    // Captured child diagnostics add terminal nodes after the bounded execution result.
    expect(ordinary.runDiagnostics.entries).toHaveLength(childCalls)
    const recorded = await run(0, true)
    expect(recorded.code, recorded.stderr).toBe(0)
    const { runId, callEvidence, ...smallResult } = JSON.parse(recorded.stdout)
    expect(smallResult).toEqual(ordinary)
    expect(readPrivateSavedCalls(callEvidence, runId)).toEqual(callEvidence)
    expect(callEvidence.coverage).toBe('complete')
    expect(callEvidence.calls).toEqual(
      Array.from({ length: childCalls }, (_, index) => ({
        id: index + 1,
        caller: 'binding:app',
        slot: 'worker',
        target: 'flow:flows/worker',
        state: 'returned',
        outcome: 'done',
      })),
    )
    expect(recorded.stderr).not.toContain('JIG_REPORT_LIMIT')

    const count = JSON_1_LIMITS.nodes - nodes(ordinary)
    const large = await run(count, false)
    expect(large.code, large.stderr).toBe(0)
    const terminal = JSON.parse(large.stdout)
    expect(nodes(terminal)).toBe(JSON_1_LIMITS.nodes)
    expect(() => validateJson1(terminal)).not.toThrow()
    expect(canonicalJson(terminal).byteLength).toBeLessThan(JSON_1_LIMITS.bytes)
    expect(large.stdout).toBe(`${Buffer.from(canonicalJson(terminal)).toString()}\n`)
    expect({ ...terminal, output: ordinary.output }).toEqual(ordinary)
    expect(terminal.output.flat()).toEqual(Array(count).fill(0))
    expect(() => validateJson1(callEvidence)).not.toThrow()
    expect(() => validateJson1({ ...terminal, runId, callEvidence })).toThrow(
      'maximum value nodes exceeded',
    )
    expect(() => validateJson1({ ...terminal, omitted: true })).toThrow(
      'maximum value nodes exceeded',
    )
    expect(large.stderr).not.toContain('JIG_REPORT_LIMIT')

    const omitted = await run(count, true)
    expect(omitted.code, omitted.stderr).toBe(large.code)
    expect(omitted.stdout).toBe(large.stdout)
    expect(omitted.stderr.match(/Diagnostic code: JIG_REPORT_LIMIT/g)).toHaveLength(1)
    expect(omitted.stderr).toContain('Requested child-call evidence was omitted')
    expect(omitted.stderr).toContain('ordinary execution result and exit status are unchanged')
    expect(omitted.stderr).toContain('Repeating the command starts new work')
    expect(omitted.stderr).not.toContain('\u001b')
    expect(await readFile(join(project, 'jig.lock'))).toEqual(lock)
    expect(await foundationResidue(qualification, command, root)).toEqual(before)
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`Call evidence boundary consumer and transcripts retained at ${root}`)
  }
}, 600_000)

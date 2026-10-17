import assert from 'node:assert/strict'
import { constants, Database } from 'bun:sqlite'
import { test } from 'bun:test'
import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PrivateCallEvent } from '../../src/cli-run-model.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import type { PrivateRunDiagnosticSource } from '../../src/internal/run-channels.js'
import { fixtureHost } from '../fixtures/agent-fixture-host.js'
import {
  foundationCommands,
  foundationResidue,
  qualifyFoundationHost,
  requireFoundationOptIn,
} from '../fixtures/host-foundation/materialize.js'

requireFoundationOptIn()
const qualification = await qualifyFoundationHost()

test('real child stderr binds direct and nested original caller operations, not flattened owner IDs', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-native-child-diagnostics-')))
  const command = foundationCommands(join(root, 'commands'))
  const before = await foundationResidue(qualification, command, root)
  const calls: PrivateCallEvent[] = []
  const diagnostics: { bytes: Buffer; source?: PrivateRunDiagnosticSource }[] = []
  let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
  let complete = false
  try {
    await mkdir(join(root, 'bindings'))
    for (const name of ['outer', 'parent', 'leaf']) {
      const flow = join(root, 'flows', name)
      await mkdir(flow, { recursive: true })
      await cp(resolve(import.meta.dir, '../../../flow-sdk/dist'), join(flow, 'sdk'), { recursive: true })
      await writeFile(join(flow, 'FLOW.meta.json'), JSON.stringify({
        name, description: 'Real native diagnostic source binding.',
        ...(name === 'leaf' ? {} : { uses: { child: {} } }),
      }))
      await writeFile(join(flow, 'FLOW.ts'), name === 'leaf'
        ? `import {handle} from './sdk/index.js';
await handle(async () => {
  console.error('native-child-diagnostic-marker');
  return {outcome:'done',output:{accepted:true}};
});`
        : `import {handle} from './sdk/index.js';
await handle(run => run.call({operationId:'same-own-operation',slot:'child',input:run.input}));`)
    }
    await writeFile(join(root, 'jig.ts'),
      `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings')});`)
    for (const [name, target] of [['outer', 'binding:parent'], ['parent', 'flow:flows/leaf']])
      await writeFile(join(root, `bindings/${name}.ts`),
        `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/${name}',slots:{child:'${target}'}});`)

    const { installedBunLocation } = await import('../fixtures/installed-bun-location.js')
    const host = fixtureHost(await openPrivateInstalledBunHost(installedBunLocation, {}))
    session = await openPrivateProjectSession({
      directory: root,
      host: {
        ...host,
        channelOutput: {
          receive: [],
          async record(value) {
            await appendFile(join(root, 'channel-records.jsonl'), `${JSON.stringify(value)}\n`, { mode: 0o600 })
          },
          call(event) { calls.push(event) },
          diagnostic(bytes, _operations, source) {
            diagnostics.push({ bytes: Buffer.from(bytes), ...(source ? { source } : {}) })
          },
        },
      },
    })
    const plan = await session.plan({ lockMode: 'update' })
    assert.equal(plan.state, 'applicable')
    if (plan.state !== 'applicable') throw Error('Native diagnostic project cannot be reviewed')
    await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
    for (const [target, depth] of [['parent', 1], ['outer', 2]] as const) {
      calls.length = 0
      diagnostics.length = 0
      const receipt = await session.rootAdministration.startRun({
        submissionId: target, target: { kind: 'binding', id: target }, input: null,
      })
      const until = performance.now() + host.runTimeoutMs + 30_000
      for (;;) {
        const status = await session.rootAdministration.runStatus(receipt)
        if (status.state === 'terminal') {
          assert.equal(status.terminal.status, 'succeeded')
          if (status.terminal.status !== 'succeeded') throw Error('Native diagnostic invocation failed')
          assert.deepEqual(status.terminal.output, { accepted: true })
          break
        }
        if (performance.now() >= until) throw Error('Native diagnostic invocation did not settle')
        await Bun.sleep(25)
      }
      const marker = Buffer.concat(diagnostics.map(record => record.bytes)).toString('utf8')
      assert.match(marker, /native-child-diagnostic-marker/)
      const sources = diagnostics.filter(record => record.bytes.length > 0).map(record => record.source)
      assert.ok(sources.length > 0)
      const source = sources[0]!
      assert.ok(source?.call)
      for (const value of sources) assert.deepEqual(value, source)
      const admittedCalls = calls.filter(call => call.childPublisher !== undefined)
      assert.equal(admittedCalls.length, depth)
      for (const call of admittedCalls) assert.equal(call.operationId, 'same-own-operation')
      const leaf = admittedCalls.filter(call => call.childPublisher === source.emitter)
      assert.equal(leaf.length, 1)
      assert.deepEqual(source.call, {
        publisher: leaf[0]!.publisher, operationId: 'same-own-operation',
      })
      if (depth === 2) {
        const parent = admittedCalls.filter(call => call.childPublisher === source.call!.publisher)
        assert.equal(parent.length, 1)
        assert.notEqual(source.call.publisher, parent[0]!.publisher)
      }
      const database = Database.open(join(root, '.jig/jig.sqlite3'),
        constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW)
      try {
        database.exec('PRAGMA query_only = ON')
        assert.deepEqual(database.query('SELECT count(*) AS n FROM root_child_owners').get(), { n: 0 })
      } finally {
        database.close()
      }
      assert.deepEqual((await readdir(join(root, '.jig/private-root-owners')))
        .filter(name => /^(c-|x-)/.test(name)), [])
    }
    await session.close()
    session = undefined
    assert.deepEqual(await foundationResidue(qualification, command, root), before)
    complete = true
  } finally {
    try {
      await session?.close()
    } finally {
      if (complete) await rm(root, { recursive: true, force: true })
      else console.error(`Native child diagnostic evidence retained at ${root}`)
    }
  }
}, process.platform === 'darwin' ? 600_000 : 180_000)

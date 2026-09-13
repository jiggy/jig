import { constants, Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RootAdministration, StartRootRunReceipt } from '../src/administration/root.js'
import { openPrivateInstalledBunHost } from '../src/internal/installed-bun-host.js'
import { openPrivateProjectSession } from '../src/internal/project-session-controller.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const proof = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? describe.serial : describe.skip
proof('delegated HTTP through contained root and child Runs', () => {
  test('fences a credential-bearing worker after coordinator loss without redispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-http-loss-'))
    let requests = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        requests++
        return new Promise<Response>((resolve) =>
          request.signal.addEventListener('abort', () => resolve(new Response('stopped')), {
            once: true,
          }),
        )
      },
    })
    const grant = {
      url: `http://127.0.0.1:${server.port}/wait`,
      method: 'POST',
      bearerEnv: 'HTTP_TEST_TOKEN',
      timeoutMs: 40000,
    }
    const environment = {
      JIG_HTTP_GRANTS: JSON.stringify(
        Object.fromEntries(
          ['document', 'redirect', 'echo', 'big', 'wait'].map((name) => [name, grant]),
        ),
      ),
      HTTP_TEST_TOKEN: 'private-http-test-token',
    }
    const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    let coordinator: ReturnType<typeof Bun.spawn> | undefined
    try {
      await fixture(root)
      session = await openPrivateProjectSession({ directory: root, host })
      const plan = await session.plan({ lockMode: 'update' })
      if (plan.state !== 'applicable') throw new Error('missing HTTP admission')
      await session.apply({ planDigest: plan.planDigest })
      await session.close()
      session = undefined
      const program = `
        import {openPrivateProjectSession} from ${JSON.stringify(join(import.meta.dir, '../src/internal/project-session-controller.ts'))};
        import {openPrivateInstalledBunHost} from ${JSON.stringify(join(import.meta.dir, '../src/internal/installed-bun-host.ts'))};
        import {writeFile} from 'node:fs/promises';
        const session = await openPrivateProjectSession({directory:${JSON.stringify(root)},host:await openPrivateInstalledBunHost(${JSON.stringify(installedBunLocation)},process.env)});
        const receipt = await session.rootAdministration.startRun({submissionId:'lost-http',target:{kind:'binding',id:'parent'},input:{resource:'wait',body:{text:'question'}}});
        await writeFile(${JSON.stringify(join(root, 'receipt.json'))}, JSON.stringify(receipt));
        await Bun.sleep(60000);`
      coordinator = Bun.spawn(
        [
          installedBunLocation.executablePath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          '--eval',
          program,
        ],
        {
          env: { ...process.env, ...environment },
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'inherit',
        },
      )
      await waitUntil(() => requests === 1)
      const receipt = JSON.parse(await readFile(join(root, 'receipt.json'), 'utf8'))
      coordinator.kill('SIGKILL')
      await coordinator.exited
      session = await openPrivateProjectSession({ directory: root, host })
      expect(await terminal(session.rootAdministration, receipt)).toMatchObject({
        terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
      })
      await noOwners(root)
      expect(requests).toBe(1)
    } finally {
      if (coordinator?.exitCode === null) {
        coordinator.kill('SIGKILL')
        await coordinator.exited
      }
      if (session === undefined && coordinator !== undefined)
        session = await openPrivateProjectSession({ directory: root, host })
      await session?.close()
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }, 90000)
  test('enforces exact grants outside a keyless Flow, pins policy, and settles cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-http-proof-'))
    const seen: { path: string; auth: string | null; method: string; body: string }[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname
        seen.push({
          path,
          auth: request.headers.get('authorization'),
          method: request.method,
          body: await request.text(),
        })
        if (path === '/wait')
          return await new Promise<Response>((resolve) =>
            request.signal.addEventListener('abort', () => resolve(new Response('stopped')), {
              once: true,
            }),
          )
        if (path === '/redirect')
          return new Response('moved', { status: 302, headers: { location: '/forbidden' } })
        if (path === '/echo') return new Response('private-http-test-token')
        if (path === '/big') return new Response('x'.repeat(2048))
        return new Response('trusted document')
      },
    })
    const grants = Object.fromEntries(
      ['document', 'redirect', 'echo', 'big', 'wait'].map((name) => [
        name,
        {
          url: `http://127.0.0.1:${server.port}/${name}`,
          method: 'POST',
          bearerEnv: 'HTTP_TEST_TOKEN',
          responseBytes: 1024,
          timeoutMs: 20000,
          bodySchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          },
        },
      ]),
    )
    const environment = {
      JIG_HTTP_GRANTS: JSON.stringify(grants),
      HTTP_TEST_TOKEN: 'private-http-test-token',
    }
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    try {
      await fixture(root)
      const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
      session = await openPrivateProjectSession({ directory: root, host })
      const plan = await session.plan({ lockMode: 'update' })
      expect(plan.state).toBe('applicable')
      if (plan.state !== 'applicable') throw new Error(JSON.stringify(plan))
      const review = plan.review
      expect(JSON.stringify(review)).toContain(`http://127.0.0.1:${server.port}/document`)
      expect(JSON.stringify(review)).not.toContain('private-http-test-token')
      await session.apply({ planDigest: plan.planDigest })
      let count = 0
      const start = (input: unknown, id = 'reader') =>
        session!.rootAdministration.startRun({
          submissionId: `http-${++count}`,
          target: { kind: 'binding', id },
          input: input as never,
        })
      const run = async (input: unknown, id?: string) =>
        terminal(session!.rootAdministration, await start(input, id))
      const valid = { resource: 'document', body: { text: 'question' } }
      expect(await run(valid)).toMatchObject({
        terminal: { status: 'succeeded', output: { status: 200, body: 'trusted document' } },
      })
      expect(await run(valid, 'parent')).toMatchObject({
        terminal: { status: 'succeeded', output: { status: 200, body: 'trusted document' } },
      })
      expect(seen).toEqual(
        [0, 1].map(() => ({
          path: '/document',
          method: 'POST',
          auth: 'Bearer private-http-test-token',
          body: '{"text":"question"}',
        })),
      )
      for (const input of [
        { ...valid, url: 'http://127.0.0.1/forbidden' },
        { ...valid, headers: {} },
        { ...valid, resource: 'not-granted' },
        { ...valid, body: { text: 'question', model: 'unapproved' } },
      ])
        expect(await run(input)).toMatchObject({
          terminal: { status: 'failed', code: 'INVALID_INPUT' },
        })
      expect(seen.length).toBe(2)
      expect(await run({ probe: true, port: server.port })).toMatchObject({
        terminal: {
          status: 'succeeded',
          output: { token: null, grants: null, host: false, worker: false, network: false },
        },
      })
      expect(await run({ ...valid, resource: 'redirect' })).toMatchObject({
        terminal: { status: 'succeeded', output: { status: 302 } },
      })
      expect(await run({ ...valid, resource: 'echo' })).toMatchObject({
        terminal: { status: 'failed', code: 'INVALID_RESULT' },
      })
      expect(await run({ ...valid, resource: 'big' })).toMatchObject({
        terminal: { status: 'failed', code: 'RESOURCE_EXHAUSTED' },
      })
      expect(seen.some(({ path }) => path === '/forbidden')).toBe(false)
      const stopped = await start({ ...valid, resource: 'wait' }, 'parent')
      await waitUntil(() => seen.some(({ path }) => path === '/wait'))
      await session.close()
      session = await openPrivateProjectSession({ directory: root, host })
      expect(await terminal(session.rootAdministration, stopped)).toMatchObject({
        terminal: { status: 'failed', code: 'CANCELLED' },
      })
      await noOwners(root)
      await session.close()
      const changedHost = await openPrivateInstalledBunHost(installedBunLocation, {
        ...environment,
        JIG_HTTP_GRANTS: JSON.stringify({
          ...grants,
          document: { ...grants.document, responseBytes: 512 },
        }),
      })
      session = await openPrivateProjectSession({ directory: root, host: changedHost })
      const requestsBefore = seen.length
      let rejected = false
      try {
        const status = await run(valid)
        rejected = status.state === 'terminal' && status.terminal.status !== 'succeeded'
      } catch {
        rejected = true
      }
      expect(rejected).toBe(true)
      expect(seen.length).toBe(requestsBefore)
      await noOwners(root)
      const revised = await session.plan({ lockMode: 'locked' })
      expect(revised.state).toBe('applicable')
      if (revised.state !== 'applicable') throw new Error('changed HTTP policy cannot be reviewed')
      await session.apply({ planDigest: revised.planDigest })
      expect(await run(valid)).toMatchObject({
        terminal: { status: 'succeeded', output: { status: 200, body: 'trusted document' } },
      })
      expect(seen.length).toBe(requestsBefore + 1)
      await noOwners(root)
      // Credentials are never persisted in the lock or authority records.
      expect(await readFile(join(root, 'jig.lock'), 'utf8')).not.toContain(
        'private-http-test-token',
      )
      expect(
        (await readFile(join(root, '.jig/jig.sqlite3'))).includes(
          Buffer.from('private-http-test-token'),
        ),
      ).toBe(false)
    } finally {
      await session?.close()
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }, 180000)
})

async function fixture(root: string) {
  await mkdir(join(root, 'bindings'), { recursive: true })
  for (const name of ['reader', 'parent']) {
    const path = join(root, 'flows', name)
    await mkdir(path, { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(path, 'sdk'), { recursive: true })
    await writeFile(
      join(path, 'flow.meta.json'),
      JSON.stringify({
        name,
        description: 'Bounded HTTP resource consumer.',
        ...(name === 'reader' ? { uses: { http: { contract: './http.json' } } } : {}),
      }),
    )
    if (name === 'reader')
      await cp(
        join(import.meta.dir, '../../../docs/jig/spec/contracts/http-request/contract.json'),
        join(path, 'http.json'),
      )
    await writeFile(
      join(path, 'FLOW.ts'),
      name === 'parent'
        ? 'import {handle} from "./sdk/index.js"; await handle(run=>run.call({operationId:"reader",slot:"reader",input:run.input}));'
        : `import {handle} from './sdk/index.js'; import {existsSync} from 'node:fs';
        await handle(async run=>{
          if(run.input.probe) { let network=false; try { await fetch('http://127.0.0.1:'+run.input.port+'/forbidden',{signal:AbortSignal.timeout(200)}); network=true } catch {}
            return {outcome:'done',output:{token:process.env.HTTP_TEST_TOKEN??null,grants:process.env.JIG_HTTP_GRANTS??null,host:existsSync('/etc/passwd'),worker:existsSync('/jig-http-worker.js'),network}} }
          return run.call({operationId:'http',slot:'http',input:run.input});
        });`,
    )
  }
  await writeFile(
    join(root, 'jig.ts'),
    'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings")});',
  )
  await writeFile(
    join(root, 'bindings/reader.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/reader",http:{document:"document",redirect:"redirect",echo:"echo",big:"big",wait:"wait"}});',
  )
  await writeFile(
    join(root, 'bindings/parent.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/parent",slots:{reader:"binding:reader"}});',
  )
}
async function terminal(administration: RootAdministration, receipt: StartRootRunReceipt) {
  const until = Date.now() + 40000
  while (Date.now() < until) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  throw new Error('HTTP Run did not settle')
}
async function waitUntil(ready: () => boolean) {
  const until = Date.now() + 30000
  while (!ready()) {
    if (Date.now() > until) throw new Error('HTTP request did not arrive')
    await Bun.sleep(20)
  }
}
async function noOwners(root: string) {
  const database = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    expect(
      (database.query('SELECT count(*) AS n FROM root_child_owners').get() as { n: number }).n,
    ).toBe(0)
  } finally {
    database.close()
  }
  expect(
    (await readdir(join(root, '.jig/private-root-linux-owners'))).filter((name) =>
      /^(x-|c-)/.test(name),
    ),
  ).toEqual([])
}

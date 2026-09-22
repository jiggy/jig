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
    const grants = Object.fromEntries(
      ['document', 'redirect', 'echo', 'big', 'wait'].map((name) => [name, grant]),
    )
    const environment = { HTTP_TEST_TOKEN: 'private-http-test-token' }
    const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
    let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
    let coordinator: ReturnType<typeof Bun.spawn> | undefined
    try {
      await fixture(root, grants)
      session = await openPrivateProjectSession({ directory: root, host })
      const plan = await session.plan({ lockMode: 'update' })
      if (plan.state !== 'applicable') throw new Error('missing HTTP admission')
      await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
      await session.close()
      session = undefined
      const program = `
        import {openPrivateProjectSession} from ${JSON.stringify(join(import.meta.dir, '../src/internal/project-session-controller.ts'))};
        import {openPrivateInstalledBunHost} from ${JSON.stringify(join(import.meta.dir, '../src/internal/installed-bun-host.ts'))};
        import {writeFile} from 'node:fs/promises';
        const session = await openPrivateProjectSession({directory:${JSON.stringify(root)},host:await openPrivateInstalledBunHost(${JSON.stringify(installedBunLocation)},process.env)});
        const receipt = await session.rootAdministration.startRun({submissionId:'lost-http',target:{kind:'binding',id:'parent'},input:{slot:'wait',body:{text:'question'}}});
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
  for (const [scenario, name] of Object.entries({
    input: 'validates HTTP input and exact root and child grants before dispatch',
    response: 'isolates HTTP credentials and bounds responses without following redirects',
    cancellation: 'settles a child HTTP request before closing its parent',
    policy: 'pins HTTP policy until explicit authority approval',
  })) {
    test(name, async () => {
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
        HTTP_TEST_TOKEN: 'private-http-test-token',
      }
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      let completed = false
      try {
        await fixture(root, grants)
        const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
        session = await openPrivateProjectSession({ directory: root, host })
        const plan = await session.plan({ lockMode: 'update' })
        expect(plan.state).toBe('applicable')
        if (plan.state !== 'applicable') throw new Error(JSON.stringify(plan))
        const review = plan.review
        expect(JSON.stringify(review)).toContain(`http://127.0.0.1:${server.port}/document`)
        expect(JSON.stringify(review)).not.toContain('private-http-test-token')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
        let count = 0
        const start = (input: unknown, id = 'reader') =>
          session!.rootAdministration.startRun({
            submissionId: `http-${++count}`,
            target: { kind: 'binding', id },
            input: input as never,
          })
        const run = async (input: unknown, id?: string) =>
          terminal(session!.rootAdministration, await start(input, id))
        const valid = { slot: 'document', body: { text: 'question' } }
        if (scenario === 'input') {
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
            { ...valid, body: { text: 'question', model: 'unapproved' } },
          ])
            expect(await run(input)).toMatchObject({
              terminal: { status: 'failed', code: 'INVALID_INPUT' },
            })
          expect(await run({ ...valid, slot: 'not-granted' })).toMatchObject({
            terminal: { status: 'failed', code: 'UNAVAILABLE' },
          })
          expect(seen.length).toBe(2)
        } else if (scenario === 'response') {
          expect(await run({ probe: true, port: server.port })).toMatchObject({
            terminal: {
              status: 'succeeded',
              output: { token: null, host: false, worker: false, network: false },
            },
          })
          expect(await run({ ...valid, slot: 'redirect' })).toMatchObject({
            terminal: { status: 'succeeded', output: { status: 302 } },
          })
          expect(await run({ ...valid, slot: 'echo' })).toMatchObject({
            terminal: { status: 'failed', code: 'INVALID_RESULT' },
          })
          expect(await run({ ...valid, slot: 'big' })).toMatchObject({
            terminal: { status: 'failed', code: 'RESOURCE_EXHAUSTED' },
          })
          expect(seen.some(({ path }) => path === '/forbidden')).toBe(false)
        } else if (scenario === 'cancellation') {
          const stopped = await start({ ...valid, slot: 'wait' }, 'parent')
          await waitUntil(() => seen.some(({ path }) => path === '/wait'))
          await session.close()
          session = await openPrivateProjectSession({ directory: root, host })
          expect(await terminal(session.rootAdministration, stopped)).toMatchObject({
            terminal: { status: 'failed', code: 'CANCELLED' },
          })
        } else {
          expect(await run(valid)).toMatchObject({
            terminal: { status: 'succeeded', output: { status: 200, body: 'trusted document' } },
          })
          await session.close()
          await writeFile(
            join(root, 'grants/document.json'),
            JSON.stringify({ kind: 'http', ...grants.document, responseBytes: 512 }),
          )
          session = await openPrivateProjectSession({ directory: root, host })
          const requestsBefore = seen.length
          // Source changes propose new authority; the admitted generation continues unchanged.
          expect(await run(valid)).toMatchObject({ terminal: { status: 'succeeded' } })
          const revised = await session.plan({ lockMode: 'update' })
          if (revised.state !== 'applicable')
            throw new Error('changed HTTP policy cannot be reviewed')
          expect(revised.review.authorityChanges).toBe(true)
          await expect(session.apply({ planDigest: revised.planDigest })).rejects.toMatchObject({
            code: 'AUTHORITY_APPROVAL_REQUIRED',
          })
          await session.apply({ planDigest: revised.planDigest, allowAuthorityChanges: true })
          expect(await run(valid)).toMatchObject({
            terminal: { status: 'succeeded', output: { status: 200, body: 'trusted document' } },
          })
          expect(seen.length).toBe(requestsBefore + 2)
        }
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
        await session.close()
        session = undefined
        completed = true
      } finally {
        try {
          await session?.close()
        } finally {
          await server.stop(true)
          if (completed) await rm(root, { recursive: true, force: true })
          else console.error(`Retained HTTP fixture: ${root}`)
        }
      }
    }, 180000)
  }
})

async function fixture(root: string, grants: Record<string, unknown>) {
  await mkdir(join(root, 'bindings'), { recursive: true })
  await mkdir(join(root, 'grants'), { recursive: true })
  for (const [name, policy] of Object.entries(grants))
    await writeFile(
      join(root, 'grants', name + '.json'),
      JSON.stringify({ kind: 'http', ...(policy as object) }),
    )
  for (const name of ['reader', 'parent']) {
    const path = join(root, 'flows', name)
    await mkdir(path, { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(path, 'sdk'), { recursive: true })
    await writeFile(
      join(path, 'FLOW.meta.json'),
      JSON.stringify({
        name,
        description: 'Bounded HTTP resource consumer.',
        ...(name === 'reader'
          ? {
              uses: Object.fromEntries(
                Object.keys(grants).map((name) => [name, { contract: './http.json' }]),
              ),
            }
          : {}),
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
            return {outcome:'done',output:{token:process.env.HTTP_TEST_TOKEN??null,host:existsSync('/etc/passwd'),worker:existsSync('/jig-http-worker.js'),network}} }
          const {slot,...input}=run.input; return run.call({operationId:'http',slot,input});
        });`,
    )
  }
  await writeFile(
    join(root, 'jig.ts'),
    'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings"),grants:discover("grants")});',
  )
  await writeFile(
    join(root, 'bindings/reader.ts'),
    'import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/reader",slots:{document:"grant:document",redirect:"grant:redirect",echo:"grant:echo",big:"grant:big",wait:"grant:wait"}});',
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

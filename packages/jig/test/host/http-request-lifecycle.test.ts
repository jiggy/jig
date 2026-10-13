import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { constants, Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RootAdministration, StartRootRunReceipt } from '../../src/administration/root.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { privateDomainDigest } from '../../src/internal/identity.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { settleTestCommand } from '../fixtures/bounded-command.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import { untrustedCertificate, untrustedKey } from '../http-tls-fixture.js'

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
    await cp(join(suiteTestRoot, '../../flow-sdk/dist'), join(path, 'sdk'), { recursive: true })
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
        join(suiteTestRoot, '../../../docs/jig/spec/contracts/http-request/contract.json'),
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
  const until = Date.now() + (process.platform === 'darwin' ? 75000 : 40000)
  while (Date.now() < until) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  throw new Error('HTTP Run did not settle')
}
async function waitUntil(ready: () => boolean) {
  const until = Date.now() + (process.platform === 'darwin' ? 60000 : 30000)
  while (!ready()) {
    if (Date.now() > until) throw new Error('HTTP request did not arrive')
    await Bun.sleep(20)
  }
}
async function liveHttpOwner(root: string, receipt: StartRootRunReceipt, scope: string) {
  const database = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  let owner: any
  try {
    database.exec('PRAGMA query_only = ON; BEGIN')
    const rows = database
      .query(
        'SELECT allocation_digest, allocation_bytes, sandbox_digest, sandbox_bytes, fence_digest, cleanup_digest FROM root_child_owners WHERE parent_run_id = ? AND scope_operation_id = ? AND operation_id = ?',
      )
      .all(receipt.runId, scope, 'http') as {
      allocation_digest: string
      allocation_bytes: Uint8Array
      sandbox_digest: string
      sandbox_bytes: Uint8Array
      fence_digest: string | null
      cleanup_digest: string | null
    }[]
    expect(rows.length).toBe(1)
    const row = rows[0]!
    let allocation: any, sandbox: any
    try {
      allocation = JSON.parse(Buffer.from(row.allocation_bytes).toString())
      sandbox = JSON.parse(Buffer.from(row.sandbox_bytes).toString())
    } catch {
      throw Error('The live HTTP owner evidence is unreadable')
    }
    expect(privateDomainDigest('JIG-Private-Root-Child-Owner-Allocation/1', allocation)).toBe(
      row.allocation_digest,
    )
    expect(privateDomainDigest('JIG-Private-Root-Child-Sandbox/1', sandbox)).toBe(
      row.sandbox_digest,
    )
    expect(allocation.kind).toBe('private-contained-effect-owner/1')
    expect(allocation.effect).toBe('http-request')
    expect(allocation.parentRunId).toBe(receipt.runId)
    expect(allocation.operationId).toBe('http')
    expect(allocation.parentFlow?.operationId ?? '').toBe(scope)
    expect(row.fence_digest === null && row.cleanup_digest === null).toBe(true)
    const identity = privateDomainDigest('JIG-Contained-Effect-Owner/1', {
      parentRunId: receipt.runId,
      operationId: 'http',
      parentOperationId: scope || null,
    }).slice(7)
    owner = allocation.ownerAllocation
    expect(owner.name).toBe(`x-${identity.slice(0, 62)}`)
    expect(owner.parent).toBe(await realpath(join(root, '.jig/private-root-owners')))
    expect(owner.directory).toBe(join(owner.parent, owner.name))
    expect(sandbox.runId).toBe(`effect-${identity.slice(0, 40)}`)
    expect(
      sandbox.kind === 'private-macos-sealed-owner/1'
        ? sandbox.allocation.digest
        : sandbox.ownerStateAllocationDigest,
    ).toBe(owner.digest)
  } finally {
    database.exec('ROLLBACK')
    database.close()
  }
  if (process.platform === 'darwin') {
    expect(owner.kind).toBe('private-macos-owner-state-allocation/1')
    const physical = await lstat(owner.directory, { bigint: true })
    expect(
      physical.isDirectory() &&
        physical.uid === BigInt(process.getuid!()) &&
        (physical.mode & 0o777n) === 0o700n &&
        String(physical.dev) === owner.directoryDevice &&
        String(physical.ino) === owner.directoryInode,
    ).toBe(true)
    for (const path of ['data', 'control/guardian/storage']) {
      let absent = false
      try {
        await lstat(join(owner.directory, path))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        absent = true
      }
      expect(absent).toBe(true)
    }
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
    (await readdir(join(root, '.jig/private-root-owners'))).filter((name) => /^(x-|c-)/.test(name)),
  ).toEqual([])
}

describe.serial('delegated HTTP through contained root and child Runs', () => {
  test(
    'fences a credential-bearing worker after coordinator loss without redispatch',
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-http-loss-')))
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
        import {openPrivateProjectSession} from ${JSON.stringify(join(suiteTestRoot, '../src/internal/project-session-controller.ts'))};
        import {openPrivateInstalledBunHost} from ${JSON.stringify(join(suiteTestRoot, '../src/internal/installed-bun-host.ts'))};
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
        await liveHttpOwner(root, receipt, 'reader')
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
    },
    process.platform === 'darwin' ? 180000 : 90000,
  )
  for (const [scenario, name] of Object.entries({
    input: 'validates HTTP input and exact root and child grants before dispatch',
    response: 'isolates HTTP credentials and bounds responses without following redirects',
    cancellation: 'settles a child HTTP request before closing its parent',
    policy: 'pins HTTP policy until explicit authority approval',
  })) {
    test(
      name,
      async () => {
        const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-http-proof-')))
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
        const onRootExecutionFailure = (evidence: { phase: string; causes: readonly string[] }) =>
          console.error('http-root-execution-failure', JSON.stringify(evidence))
        try {
          await fixture(root, grants)
          const host = await openPrivateInstalledBunHost(installedBunLocation, environment)
          session = await openPrivateProjectSession({
            directory: root,
            host,
            onRootExecutionFailure,
          })
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
            await liveHttpOwner(root, stopped, 'reader')
            await session.close()
            session = await openPrivateProjectSession({
              directory: root,
              host,
              onRootExecutionFailure,
            })
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
            session = await openPrivateProjectSession({
              directory: root,
              host,
              onRootExecutionFailure,
            })
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
      },
      process.platform === 'darwin' ? 360000 : 180000,
    )
  }
  test(
    'resolves a local TLS name and preserves certificate refusal without an HTTP request',
    async () => {
      const caseStarted = performance.now()
      const peerActiveDeadline =
        caseStarted + (process.platform === 'darwin' ? 180000 : 90000) - 15000
      const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-http-tls-')))
      let completed = false
      const node = process.env.FLOW_NODE ?? process.env.JIG_AUTHORING_NODE_PATH
      if (!node || !isAbsolute(node))
        throw Error('TLS peer requires the qualified absolute Node executable')
      await writeFile(
        join(root, 'tls-peer-config.json'),
        JSON.stringify({ key: untrustedKey, cert: untrustedCertificate }),
        { mode: 0o600, flag: 'wx' },
      )
      if (performance.now() >= peerActiveDeadline) throw Error('TLS peer active budget unavailable')
      const peer = Bun.spawn(
        [node, fileURLToPath(new URL('../fixtures/http-tls-peer.mjs', import.meta.url)), root],
        {
          cwd: root,
          env: {},
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const peerResult = settleTestCommand(peer, {
        evidence: join(root, 'tls-peer'),
        timeoutMs: Math.max(1, peerActiveDeadline - performance.now()),
        stdoutLimit: 4096,
        stderrLimit: 4096,
      })
      void peerResult.catch(() => undefined)
      let stopping = false
      const stopPeer = async () => {
        let endError: unknown
        if (!stopping) {
          stopping = true
          try {
            peer.stdin.end()
          } catch (error) {
            endError = error
          }
        }
        const result = await peerResult
        if (endError !== undefined) throw Error('TLS peer input closure failed')
        if (result.code !== 0 || result.stderr !== '') throw Error('Real Node TLS peer failed')
        const counts = JSON.parse(result.stdout) as {
          connections: number
          requests: number
        }
        if (
          Object.keys(counts).sort().join() !== 'connections,requests' ||
          !Number.isSafeInteger(counts.connections) ||
          counts.connections < 0 ||
          !Number.isSafeInteger(counts.requests) ||
          counts.requests < 0
        )
          throw Error('Invalid TLS peer counts')
        return counts
      }
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      try {
        const readyPath = join(root, 'tls-peer.ready.json')
        const readyUntil = Math.min(performance.now() + 5000, peerActiveDeadline)
        let address: { port: number } | undefined
        while (!address) {
          if (peer.exitCode !== null || performance.now() >= readyUntil)
            throw Error('Missing local TLS endpoint')
          try {
            const value = JSON.parse(await readFile(readyPath, 'utf8')) as { port: number }
            if (
              Object.keys(value).join() !== 'port' ||
              !Number.isSafeInteger(value.port) ||
              value.port < 1 ||
              value.port > 65535
            )
              throw Error('Invalid real Node TLS readiness')
            address = value
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            if (peer.exitCode !== null || performance.now() >= readyUntil)
              throw Error('Missing local TLS endpoint')
            await Bun.sleep(10)
          }
        }
        const grant = { url: `https://localhost:${address.port}/`, method: 'POST', timeoutMs: 5000 }
        await fixture(
          root,
          Object.fromEntries(
            ['document', 'redirect', 'echo', 'big', 'wait'].map((name) => [name, grant]),
          ),
        )
        const host = await openPrivateInstalledBunHost(installedBunLocation, {})
        session = await openPrivateProjectSession({ directory: root, host })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable') throw Error('Missing local TLS admission')
        await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })
        const receipt = await session.rootAdministration.startRun({
          submissionId: 'tls-no-volume',
          target: { kind: 'binding', id: 'reader' },
          input: { slot: 'document', body: { text: 'bounded' } },
        })
        expect(await terminal(session.rootAdministration, receipt)).toMatchObject({
          terminal: { status: 'failed', code: 'UNCERTAIN' },
        })
        const { connections, requests } = await stopPeer()
        expect(connections).toBeGreaterThan(0)
        expect(requests).toBe(0)
        await noOwners(root)
        await session.close()
        session = undefined
        completed = true
      } finally {
        try {
          await session?.close()
        } finally {
          try {
            await stopPeer()
          } finally {
            if (completed) await rm(root, { recursive: true, force: true })
            else console.error(`Retained HTTP TLS fixture: ${root}`)
          }
        }
      }
    },
    process.platform === 'darwin' ? 180000 : 90000,
  )
})

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires opted-in native host qualification')

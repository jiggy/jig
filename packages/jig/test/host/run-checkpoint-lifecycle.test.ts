import { flowSdkRuntimeDirectory } from './../fixtures/flow-dependency'
import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { constants, Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readPrivateAttemptRunCheckpoint,
  readPrivateRootRun,
  savePrivateAttemptRunCheckpoint,
} from '../../src/internal/activation-admission-store.js'
import { privateOwnFileCommand } from '../../src/internal/file-command.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'

const jig = join(suiteTestRoot, '../bin/jig')
async function cli(root: string, args: string[]) {
  const process = Bun.spawn([jig, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { code, stdout, stderr }
}
// An independently authored Run/0 peer controls only its own protocol reads.
// After the selected save it never requests another input frame: a result may
// reach the pipe, but cannot be observed by this Flow before coordinator loss.
const unacknowledgedCheckpointFlow = `
const reader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let buffered = '';
async function receive() {
  while (!buffered.includes('\\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Run input closed before checkpoint request');
    buffered += decoder.decode(chunk.value, {stream:true});
  }
  const end = buffered.indexOf('\\n');
  const frame = JSON.parse(buffered.slice(0,end));
  buffered = buffered.slice(end+1);
  return frame;
}
const send = frame => Bun.write(Bun.stdout, JSON.stringify(frame)+'\\n');
const run = await receive();
if(run.jsonrpc!=='2.0'||run.method!=='flow/run'||run.params.protocol!=='run/0')
  throw new Error('expected Run/0 invocation');
const call = (id,slot,input) => send({jsonrpc:'2.0',id,method:'flow/call',
  params:{operationId:id,slot,input}});
await call('worker:1','worker',{ms:300});
await call('worker:2','worker',{ms:60000});
const save = (sequence,text) => call('save:'+sequence,'progress',
  {sequence,evidence:{text},files:{'progress.txt':text}});
await save(1,'initial');
if(run.params.input.phase==='replacement') {
  let acknowledged=false, settled=false;
  while(!acknowledged||!settled) {
    const frame = await receive();
    if(frame.jsonrpc!=='2.0'||frame.error) throw new Error('operation failed before replacement');
    if(frame.id==='save:1') {
      if(frame.result?.outcome!=='done'||frame.result.output?.sequence!==1||
        !/^sha256:[0-9a-f]{64}$/.test(frame.result.output.digest))
        throw new Error('initial checkpoint acknowledgement missing');
      acknowledged=true;
    } else if(frame.id==='worker:1') {
      if(frame.result?.outcome!=='done'||frame.result.output?.value!=='settled')
        throw new Error('first worker did not settle');
      settled=true;
    } else throw new Error('unexpected operation result before replacement');
  }
  await save(2,'settled');
} else if(run.params.input.phase!=='accepted') throw new Error('unexpected checkpoint phase');
// Do not read or parse the selected save response. Remain a live subprocess
// until the genuine native owner fences and collects it during recovery.
await new Promise(()=>{});
`

async function fixture(validation = false, barrierUrl?: string, unacknowledged = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-checkpoint-proof-')))
  for (const name of ['root', 'worker']) {
    const path = join(root, 'flows', name)
    await mkdir(join(path, 'contracts'), { recursive: true })
    await cp(flowSdkRuntimeDirectory, join(path, 'sdk'), { recursive: true })
    await writeFile(
      join(path, 'FLOW.meta.json'),
      JSON.stringify({
        name,
        description: 'Retain bounded progress.',
        ...(name === 'root'
          ? {
              uses: {
                progress: { contract: './contracts/run-checkpoint/contract.json' },
                ...(barrierUrl ? { barrier: { contract: './http.json' } } : {}),
              },
            }
          : {}),
      }),
    )
    await writeFile(
      join(path, 'FLOW.ts'),
      name === 'worker'
        ? `import {handle} from './sdk/index.js'; await handle(async run=>{await Bun.sleep(run.input.ms);return {outcome:'done',output:{value:'settled'}}});`
        : validation
          ? `import {handle} from './sdk/index.js'; await handle(async run=>{
        let operation=0;
        const save=input=>run.call({operationId:'save:'+ ++operation,slot:'progress',input});
        const refused=async input=>{
          try { await save(input); } catch { return true; }
          throw new Error('invalid checkpoint was accepted');
        };
        const first={sequence:1,evidence:{candidate:'original'},files:{'first.txt':'original'}};
        const receipt=await save(first);
        first.files['first.txt']='mutated caller';
        const refusals=[];
        refusals.push(await refused({sequence:3,evidence:null,files:{}}));
        refusals.push(await refused({sequence:2,evidence:null,files:{'../escape':'bad'}}));
        refusals.push(await refused({sequence:2,evidence:null,files:{},artifacts:{candidate:'guessed'}}));
        const retry=await save({sequence:1,evidence:{candidate:'original'},files:{'first.txt':'original'}});
        if(retry.output.digest!==receipt.output.digest) throw new Error('rejected replacement changed progress');
        const receipts=[receipt.output];
        for(let sequence=2;sequence<=16;sequence++)
          receipts.push((await save({sequence,evidence:{sequence},files:{'latest.txt':String(sequence)}})).output);
        refusals.push(await refused({sequence:17,evidence:null,files:{}}));
        return {outcome:'done',output:{receipts,refusals}};
      });`
          : unacknowledged
            ? unacknowledgedCheckpointFlow
            : `import {handle} from './sdk/index.js'; import {writeFile} from 'node:fs/promises'; await handle(async run=>{
        const workers=[1,2].map(i=>run.call({operationId:'worker:'+i,slot:'worker',input:{ms:i===1?300:run.input.mode==='complete'?500:60000}}));
        const save=(sequence,text)=>run.call({operationId:'save:'+sequence,slot:'progress',input:{sequence,evidence:{text},files:{'progress.txt':text}}});
        const barrier=()=>run.call({operationId:'barrier',slot:'barrier',input:{}});
        if(run.input.phase==='before') await barrier();
        await save(1,'initial');
        if(run.input.phase==='acknowledged'||run.input.phase==='cancel') await barrier();
        await workers[0]; await save(2,'settled');
        await workers[1]; await writeFile(run.attachments.deliverables.path+'/progress.txt','final');
        return {outcome:'done',output:{completed:true}};
      });`,
    )
    if (name === 'root') {
      if (barrierUrl)
        await cp(
          join(suiteTestRoot, '../../../docs/jig/spec/contracts/http-request/contract.json'),
          join(path, 'http.json'),
        )
      await writeFile(
        join(path, 'FLOW.contract.json'),
        JSON.stringify({
          $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
          ...(validation ? {} : { attachments: { deliverables: 'read-write' } }),
        }),
      )
      await cp(
        join(suiteTestRoot, '../../../docs/jig/spec/contracts/run-checkpoint'),
        join(path, 'contracts/run-checkpoint'),
        { recursive: true },
      )
    }
  }
  await mkdir(join(root, 'bindings'))
  if (barrierUrl) {
    await mkdir(join(root, 'grants'))
    await writeFile(
      join(root, 'grants/barrier.json'),
      JSON.stringify({
        kind: 'http',
        url: barrierUrl,
        method: 'POST',
        timeoutMs: 30000,
      }),
    )
  }
  await writeFile(
    join(root, 'jig.ts'),
    `import {defineJig,discover} from '@jigging/jig'; export default defineJig({flows:discover('flows'),bindings:discover('bindings')${barrierUrl ? ",grants:discover('grants')" : ''}});`,
  )
  await writeFile(
    join(root, 'bindings/root.ts'),
    `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/root',slots:{worker:'flow:flows/worker'${barrierUrl ? ",barrier:'grant:barrier'" : ''}}});`,
  )
  const review = await cli(root, [
    'review',
    '--yes',
    ...(barrierUrl === undefined ? [] : ['--allow-authority-changes']),
  ])
  if (review.code !== 0)
    throw new Error(`fixture review failed: ${review.stderr}\n${review.stdout}`)
  return root
}
async function checkpointAccepted(root: string, sequence: number) {
  const database = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  let run: { run_id: string } | null
  try {
    run = database.query('SELECT run_id FROM root_runs').get() as { run_id: string } | null
  } finally {
    database.close()
  }
  if (!run) return false
  return (
    (await readPrivateAttemptRunCheckpoint({ projectRoot: root, runId: run.run_id }))?.sequence ===
    sequence
  )
}
async function noOwners(root: string, starts = 1) {
  const db = Database.open(
    join(root, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    expect((db.query('SELECT count(*) AS n FROM root_child_owners').get() as { n: number }).n).toBe(
      0,
    )
    expect(
      (db.query('SELECT count(*) AS n FROM root_spawn_intents').get() as { n: number }).n,
    ).toBe(starts)
  } finally {
    db.close()
  }
  expect(
    (await readdir(join(root, '.jig/private-root-owners'))).filter((n) => /^(r-|x-|c-)/.test(n)),
  ).toEqual([])
}

describe.serial('root retained progress', () => {
  test(
    'installed saves use protected sequence, replacement and sixteen-save limits without writable ports',
    async () => {
      const root = await fixture(true)
      try {
        const destination = join(root, 'validation')
        const result = await cli(root, [
          'run',
          'binding:root',
          '--input',
          '{}',
          '--out',
          destination,
          '--timeout',
          process.platform === 'darwin' ? '60s' : '30s',
        ])
        expect(result.code, result.stderr + result.stdout).toBe(0)
        const packet = JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))
        expect(JSON.parse(result.stdout)).toEqual(packet)
        expect(packet.output.refusals).toEqual([true, true, true, true])
        expect(
          packet.output.receipts.map((receipt: { sequence: number }) => receipt.sequence),
        ).toEqual(Array.from({ length: 16 }, (_, index) => index + 1))
        const protectedCheckpoint = await readPrivateAttemptRunCheckpoint({
          projectRoot: root,
          runId: packet.runId,
        })
        expect(protectedCheckpoint).toEqual(packet.checkpoint)
        expect(protectedCheckpoint?.sequence).toBe(16)
        expect(protectedCheckpoint?.files).toEqual({ 'latest.txt': '16' })
        expect(protectedCheckpoint?.digest).toBe(packet.output.receipts[15].digest)
        if (!protectedCheckpoint) throw new Error('protected checkpoint is missing')
        const run = await readPrivateRootRun({ projectRoot: root, runId: packet.runId })
        await expect(
          savePrivateAttemptRunCheckpoint({
            projectRoot: root,
            runId: run.runId,
            epoch: run.coordinatorEpoch,
            identity: protectedCheckpoint.identity,
            value: { sequence: 16, evidence: null, files: {} },
            artifacts: {},
          }),
        ).rejects.toThrow('unavailable')
        expect(
          await readPrivateAttemptRunCheckpoint({ projectRoot: root, runId: run.runId }),
        ).toEqual(protectedCheckpoint)
        await noOwners(root)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    process.platform === 'darwin' ? 120_000 : 60_000,
  )
  test(
    'installed command delivers normal output and retains saved files on deadline',
    async () => {
      const root = await fixture()
      try {
        for (const mode of ['complete', 'deadline']) {
          const result = await cli(root, [
            'run',
            'binding:root',
            '--input',
            JSON.stringify({ mode }),
            '--out',
            join(root, mode),
            '--timeout',
            // Leave the normal root budget for the first child and two durable
            // saves. The second child waits 60s, so deadline fencing is still required.
            process.platform === 'darwin' ? '60s' : '30s',
          ])
          expect(result.code, result.stderr + result.stdout).toBe(mode === 'complete' ? 0 : 1)
          const packet = JSON.parse(await readFile(join(root, mode, 'result.json'), 'utf8'))
          expect(JSON.parse(result.stdout)).toEqual(packet)
          expect(packet.delivery.source).toBe(mode === 'complete' ? 'final' : 'checkpoint')
          expect(packet.checkpoint.sequence).toBe(2)
          expect(packet.checkpoint.identity.runId).toBe(packet.runId)
          expect(packet.status).toBe(mode === 'complete' ? 'succeeded' : 'failed')
          if (mode !== 'complete') expect(packet.code).toBe('DEADLINE_EXCEEDED')
          expect(await readFile(join(root, mode, 'files/progress.txt'), 'utf8')).toBe(
            mode === 'complete' ? 'final' : 'settled',
          )
          await noOwners(root, mode === 'complete' ? 1 : 2)
        }
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    process.platform === 'darwin' ? 150_000 : 90_000,
  )
  for (const phase of ['before', 'accepted', 'acknowledged', 'replacement', 'cancel'] as const)
    test(
      `independent owner recovers coordinator loss ${phase} acknowledgement without replay`,
      async () => {
        // A held real HTTP operation is a Flow-side barrier: it cannot dispatch
        // the next save until the operation resolves. Publication callbacks are
        // too late: protected checkpoint acceptance precedes publication.
        let coordinatorStarted = ''
        let ready = ''
        let barrierRequests = 0
        const server = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          async fetch(request) {
            if (request.method !== 'POST' || new URL(request.url).pathname !== '/barrier')
              return new Response(null, { status: 404 })
            const coordinator = Number(await readFile(coordinatorStarted, 'utf8'))
            if (!Number.isSafeInteger(coordinator) || coordinator < 2)
              throw new Error('invalid checkpoint coordinator PID')
            barrierRequests++
            process.kill(coordinator, 'SIGSTOP')
            await writeFile(ready, String(coordinator))
            return await new Promise<Response>(() => {})
          },
        })
        const unacknowledged = phase === 'accepted' || phase === 'replacement'
        const root = await fixture(
          false,
          `http://127.0.0.1:${server.port}/barrier`,
          unacknowledged,
        ).catch((error) => {
          server.stop(true)
          throw error
        })
        ready = join(root, 'coordinator.pid')
        coordinatorStarted = join(root, 'coordinator.started')
        const destination = join(root, 'result')
        let pid: number | undefined
        let stopped = false
        let finished = false
        const cancellation = new AbortController()
        const execution = privateOwnFileCommand(
          [
            installedBunLocation.executablePath,
            '--no-env-file',
            '--no-install',
            '--config=/dev/null',
            join(suiteTestRoot, 'fixtures/checkpoint-coordinator.ts'),
            root,
          ],
          [
            'run',
            'binding:root',
            '--input',
            JSON.stringify({ mode: 'deadline', phase }),
            '--out',
            destination,
            '--timeout',
            process.platform === 'darwin' ? '60s' : '30s',
          ],
          cancellation.signal,
          process.platform === 'darwin' ? 90_000 : 40_000,
        ).finally(() => {
          finished = true
        })
        try {
          const until = Date.now() + (process.platform === 'darwin' ? 45_000 : 20_000)
          while (!finished && Date.now() < until) {
            if (
              unacknowledged &&
              pid === undefined &&
              (await checkpointAccepted(root, phase === 'replacement' ? 2 : 1))
            ) {
              // Acceptance is real protected-store evidence; non-observation
              // follows from the peer never reading the selected response.
              // This does not assert that ACK bytes were never sent/buffered.
              pid = Number(await readFile(coordinatorStarted, 'utf8'))
              if (!Number.isSafeInteger(pid) || pid < 2)
                throw new Error('invalid checkpoint coordinator PID')
              process.kill(pid, 'SIGSTOP')
              await writeFile(ready, String(pid))
            }
            try {
              pid = Number(await readFile(ready, 'utf8'))
              // A sent SIGSTOP is not a stopped-state observation. Observe the
              // pause before cancellation so SIGTERM cannot race that signal.
              if (Number.isSafeInteger(pid) && pid >= 2) {
                stopped =
                  process.platform === 'darwin'
                    ? /^T/.test(
                        spawnSync('/bin/ps', ['-o', 'state=', '-p', String(pid)], {
                          encoding: 'utf8',
                          timeout: 1000,
                        }).stdout.trim(),
                      )
                    : /^State:\s+T\s/m.test(await readFile(`/proc/${pid}/status`, 'utf8'))
                if (stopped) break
              }
            } catch {
              // The PID marker or process status may not be available yet.
            }
            await Bun.sleep(20)
          }
          if (!stopped || !Number.isSafeInteger(pid) || pid! < 2)
            throw new Error('fixture did not reach selected save boundary')
          expect(barrierRequests).toBe(
            phase === 'before' || phase === 'acknowledged' || phase === 'cancel' ? 1 : 0,
          )
          if (phase === 'cancel') cancellation.abort()
          else process.kill(pid!, 'SIGKILL')
          expect((await execution).signal).toBe('SIGKILL')
          const packet = JSON.parse(await readFile(join(destination, 'result.json'), 'utf8'))
          expect(packet.status).toBe('lost')
          expect(packet.code).toBe('COORDINATOR_LOST')
          if (phase === 'before') {
            expect(packet.checkpoint).toBeNull()
            expect(await readdir(join(destination, 'files'))).toEqual([])
          } else {
            expect(packet.checkpoint.sequence).toBe(phase === 'replacement' ? 2 : 1)
            expect(await readFile(join(destination, 'files/progress.txt'), 'utf8')).toBe(
              phase === 'replacement' ? 'settled' : 'initial',
            )
          }
          await noOwners(root)
        } finally {
          try {
            if (!finished && pid !== undefined) process.kill(pid, 'SIGKILL')
            await execution
          } finally {
            server.stop(true)
            await rm(root, { recursive: true, force: true })
          }
        }
      },
      process.platform === 'darwin' ? 120_000 : 60_000,
    )
})

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires opted-in native host qualification')

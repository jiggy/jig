import { constants, Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateOwnFileCommand } from '../src/internal/file-command.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'

const proof = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? describe.serial : describe.skip
const jig = join(import.meta.dir, '../bin/jig')
proof('root retained progress', () => {
  test('installed command delivers normal output and retains saved files on deadline', async () => {
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
          '30s',
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
  }, 90_000)

  for (const phase of ['before', 'accepted', 'acknowledged', 'replacement', 'cancel'] as const)
    test(`independent owner recovers coordinator loss ${phase} acknowledgement without replay`, async () => {
      const root = await fixture()
      const ready = join(root, 'coordinator.pid'),
        destination = join(root, 'result')
      let pid: number | undefined
      let finished = false
      const cancellation = new AbortController()
      const execution = privateOwnFileCommand(
        [
          installedBunLocation.executablePath,
          '--no-env-file',
          '--no-install',
          '--config=/dev/null',
          join(import.meta.dir, 'fixtures/checkpoint-coordinator.ts'),
          root,
          ready,
          phase,
        ],
        [
          'run',
          'binding:root',
          '--input',
          '{"mode":"deadline"}',
          '--out',
          destination,
          '--timeout',
          '30s',
        ],
        cancellation.signal,
        40_000,
      ).finally(() => {
        finished = true
      })
      try {
        const until = Date.now() + 20_000
        while (!finished && Date.now() < until) {
          try {
            pid = Number(await readFile(ready, 'utf8'))
            break
          } catch {
            await Bun.sleep(20)
          }
        }
        if (!Number.isSafeInteger(pid) || pid! < 2)
          throw new Error('fixture did not reach selected save boundary')
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
        if (!finished && pid !== undefined) process.kill(pid, 'SIGKILL')
        await execution
        await rm(root, { recursive: true, force: true })
      }
    }, 60_000)
})

async function cli(root: string, args: string[]) {
  const process = Bun.spawn([jig, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { code, stdout, stderr }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-checkpoint-proof-'))
  for (const name of ['root', 'worker']) {
    const path = join(root, 'flows', name)
    await mkdir(join(path, 'contracts'), { recursive: true })
    await cp(join(import.meta.dir, '../../flow-sdk/dist'), join(path, 'sdk'), { recursive: true })
    await writeFile(
      join(path, 'FLOW.md'),
      `---\nname: ${name}\ndescription: Retain bounded progress.\n${name === 'root' ? 'attachments:\n  deliverables: read-write\nuses:\n  progress:\n    contract: ./contracts/run-checkpoint.capability.json\n' : ''}---\n`,
    )
    await writeFile(
      join(path, 'flow.ts'),
      name === 'worker'
        ? `import {handle} from './sdk/index.js'; await handle(async run=>{await Bun.sleep(run.input.ms);return {outcome:'done',output:{value:'settled'}}});`
        : `import {handle} from './sdk/index.js'; import {writeFile} from 'node:fs/promises'; await handle(async run=>{
        const workers=[1,2].map(i=>run.runChildFlow({operationId:'worker:'+i,slot:'worker',input:{ms:i===1?300:run.input.mode==='complete'?500:60000}}));
        const save=(sequence,text)=>run.callCapability({operationId:'save:'+sequence,slot:'progress',method:'save',input:{sequence,evidence:{text},files:{'progress.txt':text}}});
        await save(1,'initial');
        await workers[0]; await save(2,'settled');
        await workers[1]; await writeFile(run.attachments.deliverables.path+'/progress.txt','final');
        return {outcome:'done',output:{completed:true}};
      });`,
    )
    if (name === 'root')
      await cp(
        join(import.meta.dir, '../../../docs/jig/spec/contracts/run-checkpoint.capability.json'),
        join(path, 'contracts/run-checkpoint.capability.json'),
      )
  }
  await mkdir(join(root, 'bindings'))
  await writeFile(
    join(root, 'jig.ts'),
    `import {defineJig,discover} from '@jigging/jig'; export default defineJig({flows:discover('flows'),bindings:discover('bindings')});`,
  )
  await writeFile(
    join(root, 'bindings/root.ts'),
    `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/root',slots:{worker:'flow:flows/worker'}});`,
  )
  const review = await cli(root, ['review', '--yes'])
  if (review.code !== 0)
    throw new Error(`fixture review failed: ${review.stderr}\n${review.stdout}`)
  return root
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
    (await readdir(join(root, '.jig/private-root-linux-owners'))).filter((n) =>
      /^(r-|x-|c-)/.test(n),
    ),
  ).toEqual([])
}

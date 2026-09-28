// Disposable local diagnostic for the frozen evaluator-batching A/B plan.
// It uses only installed package CLIs and authored fixture files.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const root = process.argv[2]
if (!root || !root.startsWith('/tmp/jig-evaluator-ab.'))
  throw new Error('expected the exact disposable A/B artifact root')
const archivesRoot = process.argv[3] ?? root
if (!archivesRoot.startsWith('/tmp/jig-evaluator-ab.'))
  throw new Error('expected the frozen A/B artifact root')

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = join(source, 'packages/jig/test/fixtures/channel-conversation')
const outputPath = join(root, 'results.json')
const bun = process.execPath
const expected = {
  before: '4707723204ae31ddcc321620de9bae459d2a699d6d3cc2725bfe6d3296ca595a',
  after: 'd931b11a9d5f06117cac8385fbee6f96646edfea451c95018f6b8af438f6b72e',
  sdk: 'bdda67025a83416fed22f6d1f349f45a4f10b5800ec32b1d7bc4ecba20082294',
} as const
type Arm = 'before' | 'after'
type Variant = 'one' | 'five'
const arms: readonly Arm[] = ['before', 'after']
const variants: readonly Variant[] = ['one', 'five']
const commandLimitMs = 60_000
const outputLimit = 64 * 1024
const totalDeadline = performance.now() + 15 * 60_000
const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
process.once('SIGTERM', () => controller.abort())

const env: NodeJS.ProcessEnv = {}
for (const name of ['PATH', 'HOME', 'TMPDIR', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'BUN_INSTALL']) {
  const value = process.env[name]
  if (value !== undefined) env[name] = value
}
if (!env.PATH) throw new Error('missing PATH for installed CLI')

interface RecordEntry {
  readonly variant: Variant
  readonly arm: Arm
  readonly pair: number
  readonly kind: 'warmup' | 'measured'
  readonly order: number
  readonly reviewMs: number
  readonly stdoutDigest: string
  readonly stderrDigest: string
  readonly lockBindings: readonly string[]
  readonly tracePath: string
}

const entries: RecordEntry[] = []
let completed = false
let currentOperation = 'setup'
let failure: { readonly operation: string; readonly message: string } | undefined
try {
  const paths = Object.fromEntries(
    arms.map((arm) => [arm, {
      jig: join(archivesRoot, arm, 'jig/jigging-jig-0.1.0-alpha.25.tgz'),
      sdk: join(archivesRoot, arm, 'flow-sdk/jigging-flow-0.1.0-alpha.13.tgz'),
      cli: join(root, arm, 'cli/node_modules/.bin/jig'),
    }]),
  ) as Record<Arm, { jig: string; sdk: string; cli: string }>
  for (const arm of arms) {
    if (await sha256(paths[arm].jig) !== expected[arm]) throw new Error(`${arm} Jig archive changed`)
    if (await sha256(paths[arm].sdk) !== expected.sdk) throw new Error(`${arm} SDK archive changed`)
    const directory = join(root, arm, 'cli')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: `jig-evaluator-ab-${arm}`, private: true,
      dependencies: { '@jigging/jig': `file:${paths[arm].jig}` },
    }))
    // Installation is outside the timed boundary; the reviewed commands
    // themselves do not acquire dependencies or use the network.
    await mustRun(bun, ['install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'], directory)
    await mustRun(paths[arm].cli, ['--version'], directory)
  }

  for (const variant of variants) {
    for (let pair = -1; pair < 8; pair += 1) {
      const order: readonly Arm[] = pair % 2 === 0 ? ['before', 'after'] : ['after', 'before']
      for (const [orderIndex, arm] of order.entries()) {
        if (performance.now() >= totalDeadline) throw new Error('A/B reached its total time bound')
        const kind = pair < 0 ? 'warmup' : 'measured'
        const project = join(root, 'projects', `${variant}-${kind}-${pair + 1}-${arm}`)
        currentOperation = `${variant}/${kind}/${pair + 1}/${arm}:prepare`
        await prepare(project, paths[arm].sdk, variant)
        const tracePath = join(project, 'review-profile.jsonl')
        currentOperation = `${variant}/${kind}/${pair + 1}/${arm}:review`
        const review = await mustRun(paths[arm].cli, ['review', '--yes'], project, {
          ...env, JIG_PRIVATE_PROFILE_FILE: tracePath,
        })
        if (!review.stdout.includes('Project ready') && !review.stdout.includes('project is ready'))
          throw new Error(`review did not report readiness: ${variant}/${arm}/${pair}`)
        const lock = JSON.parse(await readFile(join(project, 'jig.lock'), 'utf8'))
        const bindingNames = Object.keys(lock.bindings ?? {}).sort()
        if (bindingNames.length !== (variant === 'one' ? 1 : 5))
          throw new Error(`review retained the wrong Binding set: ${variant}/${arm}/${pair}`)
        const record: RecordEntry = {
          variant, arm, pair, kind, order: orderIndex,
          reviewMs: review.elapsedMs,
          stdoutDigest: review.stdoutDigest,
          stderrDigest: review.stderrDigest,
          lockBindings: bindingNames,
          tracePath,
        }
        entries.push(record)
        console.log(`${variant} ${kind} ${pair + 1} ${arm}: ${review.elapsedMs.toFixed(1)} ms`)
        if (pair === -1) {
          currentOperation = `${variant}/${kind}/${pair + 1}/${arm}:run-smoke`
          const run = await mustRun(paths[arm].cli, [
            'run', 'binding:analysis', '--input', '@input.json', '--timeout', '5m', '--json',
          ], project)
          const result = JSON.parse(run.stdout)
          if (result.status !== 'succeeded' || result.outcome !== 'done')
            throw new Error(`installed Run was not successful: ${variant}/${arm}`)
        }
      }
    }
  }
  completed = true
} catch (error) {
  failure = {
    operation: currentOperation,
    message: String(error instanceof Error ? error.message : error).slice(0, 4_096),
  }
  throw error
} finally {
  const report = {
    protocol: 'local-evaluator-ab/1', complete: completed,
    host: process.env.JIG_AB_HOST_KIND ?? 'local rootless-capable Linux, not provisioned Ubuntu CI',
    beforeJigSha256: expected.before, afterJigSha256: expected.after,
    sdkSha256: expected.sdk, entries, failure,
  }
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}
if (!completed) throw new Error('A/B incomplete; inspect retained result and project records')

async function prepare(project: string, sdkArchive: string, variant: Variant) {
  await cp(fixture, project, {
    recursive: true,
    filter(path) {
      return !['AGENTS.md', 'README.md', 'node_modules', '.jig', 'jig.lock'].includes(path.split('/').at(-1)!)
    },
  })
  if (variant === 'five') {
    const binding = await readFile(join(project, 'bindings/analysis.ts'))
    for (let index = 0; index < 4; index += 1)
      await writeFile(join(project, `bindings/extra${index}.ts`), binding)
  }
  const sdk = join(project, 'sdk')
  await mkdir(sdk)
  await mustRun('tar', ['-xzf', sdkArchive, '-C', sdk, '--strip-components=1'], project)
  await writeFile(join(project, 'package.json'), JSON.stringify({
    name: 'jig-evaluator-ab-project', private: true, type: 'module',
    workspaces: ['sdk', 'flows/*'],
  }))
  for (const name of ['investigate', 'analysis', 'dataset'])
    await writeFile(join(project, 'flows', name, 'package.json'), JSON.stringify({
      name: `evaluator-ab-${name}`, private: true, type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    }))
  await mustRun(bun, ['install', '--offline', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'], project)
}

async function sha256(path: string) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function mustRun(
  executable: string, args: string[], cwd: string, childEnv: NodeJS.ProcessEnv = env,
): Promise<{ elapsedMs: number; stdout: string; stdoutDigest: string; stderrDigest: string }> {
  const began = performance.now()
  const child = spawn(executable, args, { cwd, env: childEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  const stdoutHash = createHash('sha256')
  const stderrHash = createHash('sha256')
  let stdoutBytes = 0
  let stderrBytes = 0
  let exceeded = false
  let timedOut = false
  let interrupted = false
  const stop = () => {
    if (child.pid === undefined || interrupted) return
    interrupted = true
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
  const abort = () => stop()
  controller.signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; stop() }, commandLimitMs)
  const capture = (stream: NodeJS.ReadableStream, chunks: Buffer[], hash: ReturnType<typeof createHash>, kind: 'stdout' | 'stderr') => {
    stream.on('data', (value: Buffer | string) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
      hash.update(bytes)
      if (kind === 'stdout') stdoutBytes += bytes.length
      else stderrBytes += bytes.length
      if (stdoutBytes + stderrBytes > outputLimit) { exceeded = true; stop() }
      if (Buffer.concat(chunks).length < outputLimit) chunks.push(bytes.subarray(0, outputLimit))
    })
  }
  capture(child.stdout, stdout, stdoutHash, 'stdout')
  capture(child.stderr, stderr, stderrHash, 'stderr')
  let spawnError: Error | undefined
  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once('error', (error) => { spawnError = error })
    child.once('close', (code, signal) => resolveExit({ code, signal }))
  })
  clearTimeout(timer)
  controller.signal.removeEventListener('abort', abort)
  const elapsedMs = performance.now() - began
  const out = Buffer.concat(stdout).toString('utf8').slice(0, outputLimit)
  const err = Buffer.concat(stderr).toString('utf8').slice(0, outputLimit)
  if (spawnError || timedOut || exceeded || controller.signal.aborted || exit.code !== 0 || exit.signal)
    throw new Error(`command failed (${executable} ${args.join(' ')}): exit=${exit.code} signal=${exit.signal} timeout=${timedOut} overflow=${exceeded} spawn=${spawnError?.message ?? 'none'}; stderr=${err.slice(0, 3000)}`)
  return { elapsedMs, stdout: out, stdoutDigest: stdoutHash.digest('hex'), stderrDigest: stderrHash.digest('hex') }
}

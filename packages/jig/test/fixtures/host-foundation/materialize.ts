import { constants, Database } from 'bun:sqlite'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { settleTestCommand } from '../bounded-command.js'
import { flowSdkDirectory } from '../flow-dependency.js'
import { startHostTestTiming } from '../host-test-timing.mjs'
import {
  foundationEvaluationFailureSummary,
  profilePhaseSummary,
  reportHostTestProfile,
} from '../private-profile-diagnostics.js'

export type FoundationApplication = 'adaptive' | 'documents' | 'evaluation-deadline'
export interface FoundationArchives {
  jig: string
  flow: string
  jigDigest: string
  flowDigest: string
}
export interface FoundationQualification {
  delegatedCgroup?: string
  linuxUserCgroup?: string
  systemctl?: string
}
const packageRoot = resolve(import.meta.dir, '../../..')
const schema = 'https://flow.jig.md/schemas/invocation-contract-0.schema.json'

/** Whole-file refusal, before creating consumers or executing any payload. */
export function requireFoundationOptIn(): void {
  if (
    !(
      (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
      (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
    )
  )
    throw Error('Installed host foundation requires opted-in qualified Linux or macOS native host')
}

/** Observe support without acquiring the scope the installed command must own. */
export async function qualifyFoundationHost(): Promise<FoundationQualification> {
  requireFoundationOptIn()
  const [
    { openPrivateInstalledBunHost },
    { inspectPrivateExecutionBackendSupport, observePrivateExecutionBackendMechanism },
    { installedBunLocation },
  ] = await Promise.all([
    import('../../../src/internal/installed-bun-host.js'),
    import('../../../src/internal/execution-backend.js'),
    import('../installed-bun-location.js'),
  ])
  const host = await openPrivateInstalledBunHost(installedBunLocation)
  if (process.platform !== 'linux' || process.env.AGENT_DELEGATED_CGROUP !== undefined) {
    const observed = await observePrivateExecutionBackendMechanism(host.backend)
    return 'authority' in observed && 'delegatedCgroup' in observed.authority
      ? { delegatedCgroup: observed.authority.delegatedCgroup as string }
      : {}
  }
  // Installed-consumer CI deliberately supplies no inherited delegation. The
  // public CLI must acquire its own transient user scope. Observing a direct
  // backend here would incorrectly require that scope before the CLI runs.
  await inspectPrivateExecutionBackendSupport(host.backend)
  const { privateLinuxHostToolCandidates, resolvePrivateLinuxHostPath } = await import(
    '../../../src/internal/linux-host-paths.js'
  )
  const uid = process.getuid!()
  assert.ok(Number.isSafeInteger(uid) && uid > 0, 'Native consumer requires an unprivileged user')
  const linuxUserCgroup = `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service`
  assert.equal(await realpath(linuxUserCgroup), linuxUserCgroup)
  return {
    linuxUserCgroup,
    systemctl: await resolvePrivateLinuxHostPath(privateLinuxHostToolCandidates('systemctl')),
  }
}

export function foundationEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { NO_COLOR: '1' }
  // No provider/model credentials are passed to the trusted application either.
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS',
    'FLOW_NODE',
    'JIG_AUTHORING_NODE_PATH',
    'AGENT_DELEGATED_CGROUP',
  ])
    if (process.env[key] !== undefined) result[key] = process.env[key]
  return result
}

function clientFailureSummary(stderr: string): string | undefined {
  const encoded = /^Foundation client failure: (\{[^\n]{1,1024}\})$/m.exec(stderr)?.[1]
  if (encoded === undefined) return undefined
  try {
    const value = JSON.parse(encoded)
    const summary: Record<string, string | boolean> = {}
    for (const key of ['application', 'stage', 'mode', 'terminalCode', 'code', 'operation']) {
      if (typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value[key]))
        summary[key] = value[key]
    }
    if (typeof value.uncertain === 'boolean') summary.uncertain = value.uncertain
    if (summary.application && summary.stage) return JSON.stringify(summary)
  } catch {
    // Diagnostic parsing never replaces the original bounded command failure.
  }
  return undefined
}

function resultPhaseSummary(stderr: string): string | undefined {
  const encoded = /^Foundation result phases: (\[[^\n]{0,4096}\])$/m.exec(stderr)?.[1]
  if (encoded === undefined) return undefined
  const phases = new Set([
    'result-open',
    'result-authenticate',
    'result-retention',
    'result-observe',
    'result-checkpoint',
    'result-finish',
    'result-dispose',
  ])
  try {
    const records = JSON.parse(encoded)
    if (!Array.isArray(records) || records.length > 14) return undefined
    const summary = []
    for (const record of records) {
      if (
        record === null ||
        typeof record !== 'object' ||
        !phases.has(record.phase) ||
        (record.kind !== 'start' && record.kind !== 'end') ||
        !Number.isFinite(record.timeMs) ||
        record.timeMs < 0 ||
        record.timeMs > 86_400_000 ||
        (record.kind === 'end' && record.outcome !== 'returned' && record.outcome !== 'failed')
      )
        return undefined
      summary.push({
        phase: record.phase,
        kind: record.kind,
        timeMs: record.timeMs,
        ...(record.kind === 'end' ? { outcome: record.outcome } : {}),
      })
    }
    return JSON.stringify(summary)
  } catch {
    // Only closed phase facts leave the private transcript; preserve command failure.
    return undefined
  }
}

export function foundationCommands(evidence: string, timing = false) {
  let sequence = 0
  return async (
    args: string[],
    cwd: string,
    timeoutMs = 195_000,
    profile?: 'run',
    role?: 'application',
  ) => {
    await mkdir(evidence, { recursive: true, mode: 0o700 })
    const commandEvidence = join(evidence, String(++sequence).padStart(3, '0'))
    const reviewProfile =
      args[1] === 'review' ? resolve(`${commandEvidence}.review.jsonl`) : undefined
    const runProfile = profile === 'run' ? resolve(`${commandEvidence}.run.jsonl`) : undefined
    const commandTiming = timing
      ? startHostTestTiming(
          'foundation',
          reviewProfile !== undefined
            ? 'review-command'
            : role === 'application'
              ? 'application-command'
              : args[1] === 'run'
                ? 'run-command'
                : 'fixture-command',
        )
      : () => {}
    const child = Bun.spawn(args, {
      cwd,
      env: {
        ...foundationEnvironment(),
        ...(reviewProfile === undefined ? {} : { JIG_PRIVATE_PROFILE_FILE: reviewProfile }),
        ...(runProfile === undefined ? {} : { JIG_FOUNDATION_RUN_PROFILE_FILE: runProfile }),
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    let result: Awaited<ReturnType<typeof settleTestCommand>>
    try {
      result = await settleTestCommand(child, {
        evidence: commandEvidence,
        timeoutMs,
        graceMs: 10_000,
      })
      commandTiming()
    } catch (error) {
      commandTiming('failed')
      throw error
    }
    if (timing && reviewProfile !== undefined)
      await reportHostTestProfile('foundation', 'review', reviewProfile)
    if (timing && runProfile !== undefined)
      await reportHostTestProfile('foundation', 'run', runProfile)
    const diagnostic = /Diagnostic code: ([A-Z][A-Z0-9_]{0,63})\b/.exec(result.stderr)?.[1]
    const clientFailure = clientFailureSummary(result.stderr)
    const resultPhases = resultPhaseSummary(result.stderr)
    const reviewPhases =
      result.code !== 0 && reviewProfile !== undefined
        ? await profilePhaseSummary(reviewProfile, 'review')
        : undefined
    const runPhases =
      result.code !== 0 && runProfile !== undefined
        ? await profilePhaseSummary(runProfile, 'run')
        : undefined
    const evaluationFailure =
      result.code !== 0 && runProfile !== undefined
        ? await foundationEvaluationFailureSummary(join(cwd, 'adaptive-observation.json'))
        : undefined
    assert.equal(
      result.code,
      0,
      `Installed foundation command ${sequence} failed${diagnostic ? ` (${diagnostic})` : ''}${clientFailure ? ` ${clientFailure}` : ''}${resultPhases ? ` result phases: ${resultPhases}` : ''}${reviewPhases ? ` review phases: ${reviewPhases}` : ''}${runPhases ? ` run phases: ${runPhases}` : ''}${evaluationFailure ? ` evaluation failure: ${evaluationFailure}` : ''}; see ${evidence}`,
    )
    return result
  }
}
type Command = ReturnType<typeof foundationCommands>

/** Author a real lock before qualifying a frozen source workspace through review. */
export async function lockFoundationWorkspace(project: string, command: Command): Promise<string> {
  await command(
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--lockfile-only',
      '--ignore-scripts',
      '--no-progress',
    ],
    project,
    120_000,
  )
  await rm(join(project, 'node_modules'), { recursive: true, force: true })
  return readFile(join(project, 'bun.lock'), 'utf8')
}

const digest = async (path: string) =>
  `sha256:${createHash('sha256')
    .update(await readFile(path))
    .digest('hex')}`

export async function freezeFoundationArchives(
  root: string,
  command: Command,
): Promise<FoundationArchives> {
  const artifacts = join(root, 'archives')
  await mkdir(artifacts)
  const freeze = async (environment: string, directory: string, name: string) => {
    const supplied = process.env[environment]
    let source: string
    if (supplied) source = await realpath(resolve(supplied))
    else {
      const destination = join(artifacts, `${name}-pack`)
      await mkdir(destination)
      await command(
        name === 'jig'
          ? [process.execPath, 'scripts/pack.ts', '--destination', destination]
          : [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        directory,
        120_000,
      )
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      source = join(
        destination,
        `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
      )
    }
    const before = await digest(source)
    const frozen = join(artifacts, `${name}.tgz`)
    await copyFile(source, frozen)
    assert.equal(await digest(frozen), before)
    assert.equal(await digest(source), before)
    return { path: frozen, digest: before }
  }
  const jig = await freeze('JIG_PACKAGE_ARCHIVE', packageRoot, 'jig')
  const flow = await freeze('FLOW_SDK_PACKAGE_ARCHIVE', flowSdkDirectory, 'flow')
  const result = { jig: jig.path, flow: flow.path, jigDigest: jig.digest, flowDigest: flow.digest }
  await writeFile(join(root, 'frozen-artifacts.json'), JSON.stringify(result, null, 2), {
    flag: 'wx',
    mode: 0o600,
  })
  return result
}

async function put(root: string, path: string, value: string | object): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(
    join(root, path),
    typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    { flag: 'wx' },
  )
}

/** Ordinary authoring sources. No imported source fixture or product-private helper enters a consumer. */
export async function materializeFoundationApplication(
  directory: string,
  application: FoundationApplication,
  barrierURL: string,
): Promise<{ project: string; entrypoints: string[] }> {
  const project = join(directory, 'project')
  await put(project, 'package.json', {
    name: `installed-foundation-${application}-project`,
    private: true,
    type: 'module',
    workspaces: ['flows/*', 'libs/*'],
  })
  await put(
    project,
    'jig.ts',
    `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings')${application === 'documents' ? ",grants:discover('grants')" : ''}})
`,
  )
  const names =
    application === 'adaptive'
      ? ['root', 'producer', 'checker']
      : application === 'documents'
        ? ['root', 'producer', 'validator']
        : ['root', 'producer']
  const entrypoints = [join(project, 'jig.ts')]
  for (const name of names) {
    await put(project, `flows/${name}/package.json`, {
      name: `foundation-${application}-${name}`,
      version: '0.0.0',
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': 'workspace:*' },
    })
    const uses =
      name !== 'root'
        ? {}
        : application !== 'documents'
          ? {
              producer: {},
              ...(application === 'adaptive' ? { checker: {} } : {}),
              evaluate: { contract: './contracts/evaluation/contract.json' },
            }
          : {
              producer: {},
              validator: {},
              barrier: { contract: './contracts/http/contract.json' },
            }
    await put(project, `flows/${name}/FLOW.meta.json`, {
      name: `foundation-${application}-${name}`,
      description: 'Maintainer-owned installed public API regression.',
      uses,
    })
    const attachments =
      name === 'root'
        ? {}
        : application !== 'documents'
          ? name === 'producer'
            ? { candidate: 'read-write' }
            : { candidate: 'read', generated: 'read' }
          : { document: name === 'producer' ? 'read-write' : 'read' }
    await put(project, `flows/${name}/FLOW.contract.json`, {
      $schema: schema,
      attachments,
      ...(name === 'root' && application !== 'evaluation-deadline'
        ? { artifactResults: application === 'adaptive' ? ['candidate', 'evidence'] : ['document'] }
        : {}),
    })
    const path = `flows/${name}/FLOW.ts`
    await put(
      project,
      path,
      await readFile(join(import.meta.dir, application, `${name}.ts.txt`), 'utf8'),
    )
    entrypoints.push(join(project, path))
  }
  const slots =
    application !== 'documents'
      ? {
          producer: { target: 'flow:flows/producer', attachments: { candidate: { create: true } } },
          evaluate: {
            kind: 'evaluation',
            recipe: 'evaluation',
            attachments: { candidate: 'supplied-read', deliverables: 'operation-create' },
          },
          ...(application === 'adaptive'
            ? {
                checker: {
                  target: 'flow:flows/checker',
                  attachments: { candidate: { supplied: 'read' }, generated: { supplied: 'read' } },
                },
              }
            : {}),
        }
      : {
          producer: { target: 'flow:flows/producer', attachments: { document: { create: true } } },
          barrier: 'grant:barrier',
          validator: {
            target: 'flow:flows/validator',
            attachments: { document: { supplied: 'read' } },
          },
        }
  await put(
    project,
    'bindings/root.ts',
    `import {defineBinding} from '@jigging/jig'
export default defineBinding(${JSON.stringify({ package: 'flows/root', slots })})
`,
  )
  entrypoints.push(join(project, 'bindings/root.ts'))
  if (application === 'documents')
    await put(project, 'grants/barrier.json', {
      kind: 'http',
      url: `${barrierURL}/hold`,
      method: 'POST',
      timeoutMs: 60_000,
      bodySchema: {
        type: 'object',
        properties: { episode: { type: 'string', enum: ['cancel', 'death'] } },
        required: ['episode'],
        additionalProperties: false,
      },
    })
  if (application !== 'documents')
    for (const file of ['package.json', 'bun.lock', 'tsconfig.json', 'evaluation.json'])
      await put(
        project,
        `evaluation/${file}`,
        await readFile(
          join(import.meta.dir, 'recipe', file === 'bun.lock' ? 'bun.lock.txt' : file),
          'utf8',
        ),
      )
  await put(
    directory,
    'client.ts',
    await readFile(join(import.meta.dir, application, 'client.ts.txt'), 'utf8'),
  )
  entrypoints.push(join(directory, 'client.ts'))
  return { project, entrypoints }
}

/** Compare all unpacked public SDK bytes with the normally installed archive. */
async function tree(directory: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  for (const entry of (await readdir(join(directory, prefix), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(result, await tree(directory, path))
    else {
      assert.equal(
        (await lstat(join(directory, path))).isFile(),
        true,
        'SDK archive must contain only ordinary files',
      )
      result[path] = await digest(join(directory, path))
    }
  }
  return result
}

/** Independent read-only native residue observation, not inferred from command exit. */
export async function foundationResidue(
  qualification: FoundationQualification,
  command: Command,
  cwd: string,
) {
  if (qualification.delegatedCgroup) {
    return (await readdir(qualification.delegatedCgroup, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('jig-run-'))
      .map((entry) => entry.name)
      .sort()
  }
  if (process.platform === 'linux') {
    assert.ok(qualification.linuxUserCgroup && qualification.systemctl)
    const listed = await command(
      [
        qualification.systemctl,
        '--user',
        'list-units',
        '--all',
        '--plain',
        '--no-legend',
        'jig-*.scope',
      ],
      cwd,
      10_000,
    )
    const residue = listed.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `unit:${line}`)
    let directories = 0
    const visit = async (directory: string): Promise<void> => {
      assert.ok(++directories <= 4096, 'Native residue traversal exceeded its bound')
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const path = join(directory, entry.name)
        if (entry.name.startsWith('jig-')) residue.push(`cgroup:${path}`)
        await visit(path)
      }
    }
    await visit(qualification.linuxUserCgroup)
    return residue.sort()
  }
  const listed = await command(['/bin/launchctl', 'list'], cwd, 10_000)
  return listed.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/).at(-1)!)
    .filter((label) => label.startsWith('org.jig.native.'))
    .sort()
}

export async function runInstalledFoundationApplication(options: {
  directory: string
  application: FoundationApplication
  archives: FoundationArchives
  qualification: FoundationQualification
}): Promise<void> {
  // This is a real external service, not a host seam. Only the reviewed HTTP
  // grant can reach /hold from the contained application. /status lets its
  // trusted client prove dispatch before interrupting the owning connection.
  const counts: Record<string, number> = { cancel: 0, death: 0 }
  const pending = new Set<() => void>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 120,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path === '/status') return Response.json(counts)
      if (path !== '/hold' || request.method !== 'POST') return new Response(null, { status: 404 })
      const { episode } = (await request.json()) as { episode: string }
      if (!Object.hasOwn(counts, episode)) return new Response(null, { status: 400 })
      counts[episode] = counts[episode]! + 1
      return new Promise<Response>((resolve) => {
        const finish = () => {
          clearTimeout(timer)
          pending.delete(finish)
          resolve(new Response('closed'))
        }
        const timer = setTimeout(finish, 60_000)
        pending.add(finish)
        request.signal.addEventListener('abort', finish, { once: true })
      })
    },
  })
  try {
    await runFoundationApplication(options, `http://127.0.0.1:${server.port}`)
    if (options.application === 'documents') assert.deepEqual(counts, { cancel: 1, death: 1 })
  } finally {
    for (const finish of pending) finish()
    await server.stop(true)
  }
}

async function runFoundationApplication(
  options: {
    directory: string
    application: FoundationApplication
    archives: FoundationArchives
    qualification: FoundationQualification
  },
  barrierURL: string,
): Promise<void> {
  const { directory, application, archives, qualification } = options
  const setupTiming = startHostTestTiming('foundation', 'setup')
  await mkdir(directory)
  const command = foundationCommands(join(directory, 'commands'), true)
  const residueBefore = await foundationResidue(qualification, command, directory)
  await writeFile(join(directory, 'residue-before.json'), JSON.stringify(residueBefore), {
    flag: 'wx',
    mode: 0o600,
  })
  await put(directory, 'package.json', {
    name: `installed-foundation-${application}`,
    private: true,
    type: 'module',
    dependencies: {
      '@jigging/jig': `file:${archives.jig}`,
      '@jigging/flow': `file:${archives.flow}`,
    },
  })
  await command(['git', 'init', '--quiet'], directory)
  await command(
    [process.execPath, 'install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
    directory,
    120_000,
  )
  assert.equal(await digest(archives.jig), archives.jigDigest)
  assert.equal(await digest(archives.flow), archives.flowDigest)
  const { project } = await materializeFoundationApplication(directory, application, barrierURL)
  const cli = join(directory, 'node_modules/.bin/jig')
  const library = join(project, 'libs/flow')
  await mkdir(library, { recursive: true })
  await command(['tar', '-xzf', archives.flow, '--strip-components=1', '-C', library], directory)
  assert.deepEqual(
    await tree(library),
    await tree(await realpath(join(directory, 'node_modules/@jigging/flow'))),
  )
  const manifests = {
    jig: JSON.parse(
      await readFile(join(directory, 'node_modules/@jigging/jig/package.json'), 'utf8'),
    ).version,
    flow: JSON.parse(await readFile(join(library, 'package.json'), 'utf8')).version,
  }
  await writeFile(join(directory, 'installed-versions.json'), JSON.stringify(manifests), {
    flag: 'wx',
    mode: 0o600,
  })
  await mkdir(join(project, 'flows/root/contracts'), { recursive: true })
  if (application !== 'documents')
    await command(
      [cli, 'import-contract', 'jig:project-evaluation', 'flows/root/contracts/evaluation'],
      project,
    )
  else
    await command(
      [cli, 'import-contract', 'jig:http-request', 'flows/root/contracts/http'],
      project,
    )
  // Review the operator recipe once. All candidate iterations happen inside this admission.
  // Lock the ordinary workspace before review of the frozen public SDK.
  const sourceLock = await lockFoundationWorkspace(project, command)
  setupTiming()
  await command([cli, 'review', '--yes', '--allow-authority-changes'], project)
  assert.equal(await readFile(join(project, 'bun.lock'), 'utf8'), sourceLock)
  const lock = await digest(join(project, 'jig.lock'))
  await command(
    [
      process.execPath,
      '--no-env-file',
      '--no-install',
      join(directory, 'client.ts'),
      cli,
      barrierURL,
    ],
    project,
    application === 'adaptive' ? 300_000 : 600_000,
    application === 'adaptive' ? 'run' : undefined,
    'application',
  )
  const verificationTiming = startHostTestTiming('foundation', 'verification')
  assert.equal(await digest(join(project, 'jig.lock')), lock)
  const verified = JSON.parse(await readFile(join(project, 'verified.json'), 'utf8'))
  assert.equal(verified.application, application)
  assert.equal(verified.cleanup, 'confirmed')
  if (application === 'documents') {
    assert.equal(verified.cancellationCleanup, 'confirmed')
    assert.equal(verified.deathCleanup, 'confirmed')
    assert.equal(verified.duplicateChild, true)
    assert.equal(
      new Set([verified.runId, verified.joinedRunId, verified.cancelledRunId, verified.deathRunId])
        .size,
      4,
    )
  }
  // Observe the real durable owner table independently of the application's
  // public cleanup observations and the platform-wide native inventory.
  const database = Database.open(
    join(project, '.jig/jig.sqlite3'),
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    database.exec('PRAGMA query_only = ON')
    const row = database
      .query<{ readonly n: unknown }, []>('SELECT count(*) AS n FROM root_child_owners')
      .get()
    assert.ok(row)
    assert.deepEqual(Object.keys(row), ['n'])
    assert.equal(row.n, 0)
  } finally {
    database.close()
  }
  assert.deepEqual(
    (await readdir(join(project, '.jig/private-root-owners'))).filter((name) =>
      /^(x-|c-)/.test(name),
    ),
    [],
    'Installed consumer left descendant owner storage',
  )
  const residueAfter = await foundationResidue(qualification, command, directory)
  await writeFile(join(directory, 'residue-after.json'), JSON.stringify(residueAfter), {
    flag: 'wx',
    mode: 0o600,
  })
  assert.deepEqual(residueAfter, residueBefore, 'Installed consumer left native owner residue')
  assert.equal(await digest(archives.jig), archives.jigDigest)
  assert.equal(await digest(archives.flow), archives.flowDigest)
  verificationTiming()
}

import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  requirePrivateBunLockPolicy,
  requirePrivateBunResolutionManifest,
} from '../../src/internal/bun-native-lock-policy.js'
import { checkPackageDirectory } from '../../src/package/inspect.js'
import {
  foundationCommands,
  freezeFoundationArchives,
} from '../fixtures/host-foundation/materialize.js'
import {
  writeConversationHelperCaller,
  writeInstalledConversationHelperProject,
  writeOrdinaryAcpAgent,
} from '../fixtures/ordinary-acp-agent.js'
import { writeOrdinaryAgent } from '../fixtures/ordinary-agent.js'
import {
  addBatchRepairFixture,
  agentMethodCallerProgram,
  httpCoordinatorFailureEvidence,
  repairPacketDirectory,
  writeAgentMethodProject,
  writeProject,
  writeRepairWorkspace,
  writeSkillWorkspace,
  writeSpecialistParent,
} from '../fixtures/root-agent-lifecycle.js'

const testRoot = join(import.meta.dir, '..')
const temporaryRoot = await realpath(tmpdir())

test('projects only closed coordinator failure facts from inert stderr input', () => {
  const prefix = 'agent-coordinator-root-execution-failure '
  const record = (value: unknown) => prefix + JSON.stringify(value)
  const secret = 'PRIVATE_TOKEN_PATH_RECEIPT_REQUEST'
  const projected = httpCoordinatorFailureEvidence(
    [
      secret,
      `${prefix}{`,
      record({ phase: secret, causes: ['Error'] }),
      record({ phase: 'protocol', causes: secret }),
      record({
        phase: 'admission',
        causes: [
          'Error:MACOS_GUARDIAN_BEFORE_READINESS',
          'AggregateError',
          `Error:${secret}`,
          `${secret}:CANCELLED`,
          'Error:CANCELLED:extra',
          { message: secret },
        ],
        message: secret,
        args: [secret],
      }),
      record({ phase: 'child-settlement', causes: ['TypeError', 'Error:DEADLINE_EXCEEDED'] }),
    ].join('\n'),
  )
  expect(projected).toEqual([
    { phase: 'admission', causes: ['Error:MACOS_GUARDIAN_BEFORE_READINESS', 'AggregateError'] },
    { phase: 'child-settlement', causes: ['TypeError', 'Error:DEADLINE_EXCEEDED'] },
  ])
  expect(JSON.stringify(projected)).not.toContain(secret)
  expect(httpCoordinatorFailureEvidence('')).toEqual([])
  expect(
    httpCoordinatorFailureEvidence(
      record({ phase: 'protocol', causes: ['Error'], message: secret.repeat(1_000) }),
    ),
  ).toEqual([])
  expect(
    httpCoordinatorFailureEvidence(
      Array.from({ length: 20 }, () =>
        record({ phase: 'fence', causes: Array(20).fill('Error') }),
      ).join('\n'),
    ),
  ).toEqual(Array.from({ length: 8 }, () => ({ phase: 'fence', causes: Array(8).fill('Error') })))
})

test('contact-import variants are valid current FLOW packages', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-contact-packages-'))
  try {
    await cp(join(testRoot, '../../../examples/contact-import/flows'), root, {
      recursive: true,
      filter: (path) => basename(path) !== 'node_modules',
    })
    for (const name of ['import', 'convert', 'map-code', 'map-agent', 'map-mixed']) {
      expect((await checkPackageDirectory(join(root, name))).entrypoint.path).toBe('FLOW.ts')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('constructs the Agent fixture with the complete current SDK', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-agent-fixture-'))
  try {
    await writeProject(root)
    expect((await checkPackageDirectory(join(root, 'flows/router'))).entrypoint.path).toBe(
      'FLOW.ts',
    )
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        'import { handle } from "./flows/router/flow-sdk/index.js"; if (typeof handle !== "function") throw new Error("missing handle");',
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(exitCode, stderr).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('constructs the packed ACP Agent with an exact native grant and ordinary default', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-ordinary-acp-fixture-'))
  try {
    await writeProject(root)
    await writeOrdinaryAcpAgent(root, 'codex')
    const method = join(root, 'flows/agent')
    expect((await checkPackageDirectory(method)).entrypoint.path).toBe('FLOW.ts')
    expect(await readFile(join(method, 'FLOW.ts'), 'utf8')).toContain('./dist/flow.js')
    expect(await Bun.file(join(method, 'dist/flow.js')).exists()).toBe(true)
    expect(await Bun.file(join(method, 'README.md')).exists()).toBe(true)
    expect(await Bun.file(join(method, 'node_modules')).exists()).toBe(false)
    expect(await readFile(join(root, 'bindings/agent.ts'), 'utf8')).toContain(
      '"native":{"kind":"acp","client":"codex"}',
    )
    expect(await readFile(join(root, 'jig.ts'), 'utf8')).toContain(
      'defaultProviders: { "https://jig.md/contracts/agent-run": "binding:agent" }',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('constructs an ordinary workspace caller of the packed conversation helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-conversation-helper-fixture-'))
  try {
    await writeOrdinaryAcpAgent(root, 'codex', 2)
    await writeConversationHelperCaller(root)
    expect(await Bun.file(join(root, 'flows/conversation-helper/FLOW.ts')).exists()).toBe(true)
    expect(
      JSON.parse(await Bun.file(join(root, 'flows/conversation-helper/FLOW.meta.json')).text()).uses
        .agent.requires,
    ).toEqual(['conversation'])
    const consumer = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        'import {handle} from "@jigging/flow"; import {withAgentConversation} from "@jigging/agent-method/conversation"; if (typeof handle !== "function" || typeof withAgentConversation !== "function") throw new Error("missing public package export");',
      ],
      { cwd: join(root, 'flows/conversation-helper'), stdout: 'pipe', stderr: 'pipe' },
    )
    const [exit, stdout, stderr] = await Promise.all([
      consumer.exited,
      new Response(consumer.stdout).text(),
      new Response(consumer.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

test('installs the native conversation from all four unchanged canonical archives', async () => {
  const proof = await mkdtemp(join(temporaryRoot, 'jig-native-conversation-candidate-'))
  const root = join(proof, 'consumer')
  const cli = join(proof, 'cli')
  const selections = [
    ['jig', 'JIG_PACKAGE_ARCHIVE', 'jig'],
    ['acp', 'AGENT_ACP_PACKAGE_ARCHIVE', 'agent-acp'],
    ['flow', 'FLOW_SDK_PACKAGE_ARCHIVE', 'flow-sdk'],
    ['method', 'AGENT_METHOD_PACKAGE_ARCHIVE', 'agent-method'],
  ] as const
  const hashes: Record<string, string> = {}
  const hash = async (path: string) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  const environment: Record<string, string> = {}
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'XDG_CACHE_HOME']) {
    const value = process.env[name]
    if (value !== undefined) environment[name] = value
  }
  let clean = false
  try {
    await mkdir(root)
    await mkdir(cli)
    const setup = foundationCommands(join(proof, 'commands'))
    const foundation = await freezeFoundationArchives(proof, setup)
    async function freezeAgent(name: 'agent-acp' | 'agent-method', variable: string) {
      const supplied = process.env[variable]
      if (supplied !== undefined) return realpath(supplied)
      const destination = join(proof, name)
      await mkdir(destination)
      await setup(
        [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        join(import.meta.dir, '../../..', name),
        30_000,
      )
      const packed = (await readdir(destination)).filter((entry) => entry.endsWith('.tgz'))
      expect(packed).toHaveLength(1)
      if (packed[0] === undefined) throw new Error(`Bun did not pack ${name}`)
      return join(destination, packed[0])
    }
    const archives = {
      jig: foundation.jig,
      flow: foundation.flow,
      acp: await freezeAgent('agent-acp', 'AGENT_ACP_PACKAGE_ARCHIVE'),
      method: await freezeAgent('agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'),
    }
    for (const [name] of selections) hashes[name] = await hash(archives[name])
    for (const [name, variable] of selections) {
      const error = await writeInstalledConversationHelperProject(root, cli, {
        ...archives,
        [name]: undefined,
      }).then(
        () => undefined,
        (cause: unknown) => cause,
      )
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain(`${variable} is required`)
      expect(await Bun.file(join(root, 'package.json')).exists()).toBeFalse()
    }
    const installed = await writeInstalledConversationHelperProject(root, cli, archives)
    const jig = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    const acp = JSON.parse(
      await readFile(new URL('../../../agent-acp/package.json', import.meta.url), 'utf8'),
    )
    const method = JSON.parse(
      await readFile(new URL('../../../agent-method/package.json', import.meta.url), 'utf8'),
    )
    expect(installed.versions).toEqual({
      jig: jig.version,
      acp: acp.version,
      flow: jig.devDependencies['@jigging/flow'],
      method: method.version,
    })
    for (const [name, , directory] of selections) {
      const original = Bun.spawn(['tar', '-xOf', archives[name], 'package/package.json'], {
        env: environment,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, manifest, stderr] = await Promise.all([
        original.exited,
        new Response(original.stdout).text(),
        new Response(original.stderr).text(),
      ])
      expect(exit, stderr).toBe(0)
      const destination =
        name === 'jig' ? join(cli, 'node_modules/@jigging/jig') : join(root, 'packages', directory)
      expect(await readFile(join(destination, 'package.json'), 'utf8')).toBe(manifest)
      expect(await hash(archives[name])).toBe(hashes[name])
    }
    const caller = join(root, 'flows/conversation-helper')
    const consumer = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '--config=/dev/null',
        '-e',
        'import {handle} from "@jigging/flow"; import {withAgentConversation} from "@jigging/agent-method/conversation"; import {FiniteAcpFrames} from "@jigging/agent-acp/transport"; if ([handle,withAgentConversation,FiniteAcpFrames].some(value=>typeof value!=="function")) throw Error("Missing candidate export");',
      ],
      { cwd: caller, env: environment, stdout: 'pipe', stderr: 'pipe' },
    )
    const [exit, stdout, stderr] = await Promise.all([
      consumer.exited,
      new Response(consumer.stdout).text(),
      new Response(consumer.stderr).text(),
    ])
    expect(exit, `${stdout}\n${stderr}`).toBe(0)
    const version = Bun.spawn([installed.command, '--version'], {
      cwd: root,
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [versionExit, versionOutput, versionError] = await Promise.all([
      version.exited,
      new Response(version.stdout).text(),
      new Response(version.stderr).text(),
    ])
    expect(versionExit, versionError).toBe(0)
    expect(versionOutput.trim()).toBe(jig.version)
    const members = [
      'flows/conversation-helper',
      ...selections.slice(1).map(([, , name]) => `packages/${name}`),
    ]
    for (const directory of [root, ...members.map((member) => join(root, member))]) {
      const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      expect(() =>
        requirePrivateBunResolutionManifest(manifest, directory === root ? 'root' : 'member'),
      ).not.toThrow()
    }
    const lockCopy = join(proof, 'bun-lock.jsonc')
    await cp(join(root, 'bun.lock'), lockCopy)
    const lock = (await import(lockCopy)).default
    expect(() =>
      requirePrivateBunLockPolicy(
        lock,
        new Set(members),
        process.platform === 'darwin' && process.versions.bun === '1.4.2' ? 2 : 1,
      ),
    ).not.toThrow()
    for (const [name, directory] of [
      ['@jigging/flow', 'flow-sdk'],
      ['@jigging/agent-method', 'agent-method'],
      ['@jigging/agent-acp', 'agent-acp'],
    ]) {
      const resolutions = Object.values(lock.packages).filter(
        (resolution) => Array.isArray(resolution) && resolution[0].startsWith(`${name}@`),
      )
      expect(resolutions).toEqual([[`${name}@workspace:packages/${directory}`]])
    }
    clean = true
  } finally {
    if (clean) await rm(proof, { recursive: true, force: true })
    else console.error(`Native conversation installation evidence: ${proof}`)
  }
}, 300_000)

test('constructs a locked local workspace for root and child Skill-delivery evidence', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-workspace-skill-fixture-'))
  try {
    await writeProject(root)
    await writeSpecialistParent(root)
    await writeOrdinaryAgent(root, {
      url: 'http://127.0.0.1:1/v1/responses',
      api: 'responses',
      default: true,
    })
    await writeSkillWorkspace(root, true)
    const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
    for (const member of ['router', 'parent']) {
      const source = await readFile(join(root, 'flows', member, 'FLOW.ts'), 'utf8')
      expect(source).toContain('import { marker } from "skill-context"')
      expect(source).toContain('../../libs/context/index.ts')
      expect(() => transpiler.transformSync(source)).not.toThrow()
    }
    const lock = await readFile(join(root, 'bun.lock'), 'utf8')
    expect(lock).toContain('skill-context@workspace:libs/context')
    // The self-contained packed Agent is not a workspace dependency of either caller.
    expect(lock).not.toContain('@jigging/agent-method')
    expect(lock).not.toContain('file:')
    expect(lock).not.toContain('https://')
    for (const member of ['flows/router', 'flows/parent', 'libs/context']) {
      const manifest = JSON.parse(await readFile(join(root, member, 'package.json'), 'utf8'))
      expect(() => requirePrivateBunResolutionManifest(manifest, 'member')).not.toThrow()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('assembles the batch host fixture over the current repair application', async () => {
  const project = await mkdtemp(join(temporaryRoot, 'jig-batch-assembly-'))
  try {
    await cp(join(testRoot, '../../../examples/tested-patch'), project, {
      recursive: true,
      force: true,
      filter: (path) => basename(path) !== 'node_modules',
    })
    await addBatchRepairFixture(project)
    const built = await Bun.build({
      entrypoints: [join(project, 'flows/project/FLOW.ts')],
      target: 'bun',
      external: ['@jigging/flow'],
    })
    expect(built.success, String(built.logs)).toBeTrue()
    expect(await Bun.file(join(project, 'flows/project/FLOW.ts')).text()).toContain(
      'handle(repairBatch)',
    )
    expect(await Bun.file(join(project, 'fixtures/timesheet/src/total.ts')).exists()).toBeTrue()
    expect(await readFile(join(project, 'fixtures/timesheet/test/project.test.ts'), 'utf8')).toBe(
      await readFile(
        join(testRoot, 'fixtures/repair-batch/fixtures/timesheet/test/project.test.ts.txt'),
        'utf8',
      ),
    )
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})
test('constructs unchanged packed HTTP Agent method siblings', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-agent-method-fixture-'))
  try {
    await writeAgentMethodProject(root, 'http://127.0.0.1:1/v1/chat/completions')
    const method = join(root, 'flows/method')
    expect((await checkPackageDirectory(method)).entrypoint.path).toBe('FLOW.ts')
    expect(await readFile(join(method, 'FLOW.ts'), 'utf8')).toContain('./dist/flow.js')
    expect(await Bun.file(join(method, 'dist/flow.js')).exists()).toBe(true)
    expect(await Bun.file(join(method, 'src/index.ts')).exists()).toBe(true)
    expect(await Bun.file(join(method, 'README.md')).exists()).toBe(true)
    expect(await Bun.file(join(method, 'node_modules')).exists()).toBe(false)
    const manifest = JSON.parse(await readFile(join(method, 'package.json'), 'utf8'))
    expect(manifest.name).toBe('@jigging/agent-method')
    expect(manifest.dependencies).toBeUndefined()
    const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' })
    expect(() => transpiler.transformSync(agentMethodCallerProgram())).not.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('constructs the repair application with unchanged sources and ordinary workspace dependencies', async () => {
  const root = await mkdtemp(join(temporaryRoot, 'jig-repair-workspace-fixture-'))
  try {
    await writeRepairWorkspace(root, 'http://127.0.0.1:1/v1/responses')
    const authored = join(testRoot, '../../../examples/tested-patch')
    expect(await readFile(join(root, 'project/jig.ts'), 'utf8')).toBe(
      await readFile(join(authored, 'jig.ts'), 'utf8'),
    )
    expect(await readFile(join(root, 'project/bindings/agent.ts'), 'utf8')).toContain(
      '"package":"flows/method"',
    )
    expect(await Bun.file(join(root, 'project/bindings/method.ts')).exists()).toBe(false)
    for (const member of ['.', 'flows/project', 'flows/repair']) {
      expect(await readFile(join(root, 'project', member, 'package.json'), 'utf8')).toBe(
        await readFile(join(authored, member, 'package.json'), 'utf8'),
      )
    }
    for (const member of ['project', 'repair']) {
      const original = join(authored, 'flows', member)
      const copied = join(root, 'project/flows', member)
      for (const file of await readdir(original)) {
        if (file.endsWith('.ts'))
          expect(await readFile(join(copied, file), 'utf8')).toBe(
            await readFile(join(original, file), 'utf8'),
          )
      }
      expect(await Bun.file(join(copied, 'sdk/index.js')).exists()).toBe(false)
    }
    const projectPackage = await checkPackageDirectory(join(root, 'project/flows/project'))
    const artifactNames = projectPackage.invocation?.artifactResults ?? []
    expect(artifactNames).toEqual(['deliverables'])
    const packet = join(root, 'packet')
    expect(repairPacketDirectory(packet)).toBe(join(packet, 'files', ...artifactNames, 'review'))
    const lock = await readFile(join(root, 'bun.lock'), 'utf8')
    for (const name of [
      '@jigging/flow',
      '@jigging/reporting',
      '@jigging/agent-method',
      '@jigging/agent-acp',
    ])
      expect(lock).toContain(`${name}@workspace:`)
    expect(lock).not.toContain('file:')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

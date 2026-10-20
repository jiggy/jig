import { expect, test } from 'bun:test'
import { cp, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { requirePrivateBunResolutionManifest } from '../../src/internal/bun-native-lock-policy.js'
import { checkPackageDirectory } from '../../src/package/inspect.js'
import {
  writeConversationHelperCaller,
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

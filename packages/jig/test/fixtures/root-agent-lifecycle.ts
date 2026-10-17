import { flowSdkDirectory, flowSdkRuntimeDirectory } from './flow-dependency'
import { expect } from 'bun:test'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RootAdministration, StartRootRunReceipt } from '../../src/administration/root.js'
import { main } from '../../src/cli.js'
import type { PrivateExecutionOutput } from '../../src/internal/execution-output.js'
import { PrivateFileDeliveryOwner } from '../../src/internal/file-delivery.js'
import { withPrivateInstallationVerification } from '../../src/internal/installation-verification.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import type { PrivateInstalledBunLocation } from '../../src/internal/installed-bun-support.js'
import {
  type RunCheckpointIdentity,
  type RunCheckpointInput,
} from '../../src/internal/private-run-checkpoint.js'
import {
  closedTestErrorCauses,
  openPrivateProjectSession,
} from '../../src/internal/project-session-controller.js'
import { PrivateRunCheckpoints } from '../checkpoint.fixture.js'
import { fixtureHost, MACOS_FIXTURE_SETTLEMENT_MS } from './agent-fixture-host.js'
import {
  openDeterministicFiniteAcpHost,
  writeDeterministicAcpAgent,
} from './deterministic-acp-agent.js'
import { installedBunLocation } from './installed-bun-location.js'
import { writeOrdinaryAcpAgent } from './ordinary-acp-agent.js'
import { completedResponse, writeOrdinaryAgent } from './ordinary-agent.js'
import { timeFixturePhase } from './phase-timing.js'

export const testRoot = join(import.meta.dir, '..')
const HOSTILE =
  process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
  (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
const OPENROUTER_RESPONSES_TEST_BASE_URL = 'https://openrouter.ai/api/v1'

export async function repairOutputCapture(
  ready: Extract<PrivateExecutionOutput, { kind: 'snapshot' }>['ready'],
) {
  try {
    return await ready
  } catch (error) {
    try {
      console.error(
        'repair-output-capture-failure',
        JSON.stringify({ phase: 'output-capture', causes: closedTestErrorCauses(error) }),
      )
    } catch {
      // Optional closed evidence cannot replace the original capture failure.
    }
    throw error
  }
}

export async function addBatchRepairFixture(project: string) {
  const source = join(testRoot, 'fixtures/repair-batch')
  for (const member of ['flows', 'fixtures', 'batch.json']) {
    await cp(join(source, member), join(project, member), {
      recursive: true,
      force: true,
      filter: (path) => basename(path) !== 'node_modules',
    })
  }
  // Copy unchanged current method helpers into the private batch package;
  // source-level tests import the same files directly from their owning Flows.
  const example = join(testRoot, '../../../examples/tested-patch/flows')
  for (const [method, files] of [
    ['read-project', ['capture.ts', 'checks.ts', 'logs-cases.json']],
    ['check-repair', ['evidence.ts', 'identity.ts', 'commands.ts', 'types.ts']],
    ['export-patch', ['method.ts', 'patch.ts']],
  ] as const) {
    const destination = join(project, 'flows/project', method)
    await mkdir(destination, { recursive: true })
    for (const file of files) await cp(join(example, method, file), join(destination, file))
  }
  const batchPath = join(project, 'flows/project/batch.ts')
  await writeFile(
    batchPath,
    (await readFile(batchPath, 'utf8')).replaceAll(
      '../../../../../../../examples/tested-patch/flows/',
      './',
    ),
  )
  await writeFile(
    join(project, 'bindings/repair.ts'),
    "import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/project',slots:{repair:'binding:specialist'}});\n",
  )
  const checks = join(project, 'fixtures/timesheet/test/project.test.ts')
  await rename(`${checks}.txt`, checks)
}

export const EXPECTED_STRUCTURED_AGENT_RESULT = Object.freeze({
  decision: Object.freeze({
    route: 'technical',
    evidence: Object.freeze([
      Object.freeze({
        keyLocation: 'stdin',
        selectedSkill: 'present',
        hiddenSkill: 'absent',
        sourceLine: 1,
        amount: null,
      }),
    ]),
    ambiguity: null,
  }),
})
export interface DispatchEvent {
  readonly scenario: string
  readonly keyInEnvironment?: boolean
  readonly selectedSkill: boolean
  readonly hiddenSkill: boolean
}

export async function writeInstalledFixture(root: string): Promise<PrivateInstalledBunLocation> {
  const source = installedBunLocation.releaseRoot
  const files = [
    'libexec/installed-cli.js',
    'libexec/image-preview-worker.js',
    'libexec/markdown-runtime.js',
    'libexec/linux-rootless-supervisor.js',
    'libexec/macos-native-supervisor.js',
    'libexec/macos-exec',
    ...(process.platform === 'darwin' ? ['libexec/macos-descriptor-bridge.dylib'] : []),
    'libexec/http-request-worker.js',
    'libexec/evaluator/project-evaluator-worker.js',
    'libexec/evaluator/project-evaluator-sdk.bundle.js',
    'libexec/evaluator/project-authoring-1.schema.json',
    'libexec/preparation/bun-native-preparation-worker.js',
  ]
  await Promise.all(
    [
      'libexec/agent',
      'libexec/evaluator',
      'libexec/preparation',
      `node_modules/@oven/${process.platform === 'darwin' ? (process.arch === 'arm64' ? 'bun-darwin-aarch64' : 'bun-darwin-x64-baseline') : 'bun-linux-x64-baseline'}/bin`,
    ].map((path) => mkdir(join(root, path), { recursive: true })),
  )
  await Promise.all(files.map((path) => copyFile(join(source, path), join(root, path))))
  const executablePath = await realpath(installedBunLocation.executablePath)
  await symlink(
    executablePath,
    join(
      root,
      `node_modules/@oven/${process.platform === 'darwin' ? (process.arch === 'arm64' ? 'bun-darwin-aarch64' : 'bun-darwin-x64-baseline') : 'bun-linux-x64-baseline'}/bin/bun`,
    ),
  )
  return Object.freeze({
    releaseRoot: root,
    executablePath,
    installedCliPath: join(root, 'libexec/installed-cli.js'),
  })
}

export async function writeProject(root: string): Promise<void> {
  const flow = join(root, 'flows', 'router')
  const contract = 'agent-run'
  await Promise.all(
    [
      join(flow, 'contracts', contract),
      join(flow, 'skills', 'selected'),
      join(flow, 'skills', 'hidden'),
      join(flow, 'flow-sdk'),
    ].map((path) => mkdir(path, { recursive: true })),
  )
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows") });',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(flow, 'FLOW.meta.json'),
    JSON.stringify({
      name: 'deterministic-agent-router',
      description: 'Exercises one exact contained Agent call.',
      uses: { agent: { contract: `./contracts/${contract}/contract.json` } },
    }),
  )
  await cp(
    join(testRoot, '../../../docs/jig/spec/contracts', contract),
    join(flow, 'contracts', contract),
    { recursive: true },
  )
  await writeFile(join(flow, 'skills', 'selected', 'SKILL.md'), 'SELECTED_SKILL_MARKER\n')
  await writeFile(join(flow, 'skills', 'hidden', 'SKILL.md'), 'HIDDEN_SKILL_MARKER\n')
  await writeFile(
    join(flow, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: {
        type: 'object',
        properties: {
          scenario: {
            enum: [
              'success',
              'schema-invalid',
              'schema-input-invalid',
              'malformed',
              'slow',
              'recovery',
              'api-structured',
              'api-text',
            ],
          },
        },
        required: ['scenario'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(join(flow, 'FLOW.ts'), flowProgram())
  await cp(flowSdkRuntimeDirectory, join(flow, 'flow-sdk'), { recursive: true })
}

export function agentPromptPayload(prompt: string): any {
  const lines = prompt.split('\n')
  const marker = lines.indexOf('The following value is canonical JSON:')
  if (marker < 0 || lines[marker + 1] === undefined)
    throw new Error('missing canonical Agent payload')
  return JSON.parse(lines[marker + 1]!)
}

export async function writeAgentMethodProject(
  root: string,
  url: string,
  nested = false,
): Promise<void> {
  await writeProject(root)
  await writeOrdinaryAgent(root, { url, maxCompletionTokens: 128 })
  const method = join(root, 'flows/method')
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'bindings/method-pair.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({ package: "flows/router",',
      `  slots: { left: "binding:${nested ? 'specialist' : 'method'}", right: "binding:${nested ? 'specialist' : 'method'}" } });`,
    ].join('\n'),
  )
  const router = join(root, 'flows/router')
  await mkdir(join(router, 'skills/answer-check'), { recursive: true })
  await copyFile(
    join(method, 'skills/answer-check/SKILL.md'),
    join(router, 'skills/answer-check/SKILL.md'),
  )
  await writeFile(
    join(router, 'FLOW.meta.json'),
    JSON.stringify({
      name: 'agent-method-caller',
      description: 'Exercise two ordinary HTTP Agent method calls and reject invalid requests.',
    }),
  )
  await writeFile(
    join(router, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: {
        type: 'object',
        properties: {
          scenario: {
            enum: ['batch', 'invalid-input', 'over-grant', 'oversized'],
          },
        },
        required: ['scenario'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(join(router, 'FLOW.ts'), agentMethodCallerProgram())
  if (nested) {
    const specialist = join(root, 'flows/specialist')
    await mkdir(specialist)
    await cp(join(router, 'flow-sdk'), join(specialist, 'flow-sdk'), { recursive: true })
    await writeFile(
      join(specialist, 'FLOW.ts'),
      `import { handle } from './flow-sdk/index.js';
await handle(async run => {
  if (process.env.METHOD_TEST_TOKEN !== undefined) throw new Error('credential leaked');
  return await run.call({operationId: 'left', slot: 'agent', input: run.input});
});`,
    )
    await writeFile(
      join(root, 'bindings/specialist.ts'),
      `import { defineBinding } from '@jigging/jig';
export default defineBinding({package:'flows/specialist', slots:{agent:'binding:method'}});`,
    )
  }
}

export function agentMethodCallerProgram(): string {
  return [
    'import { handle } from "./flow-sdk/index.js";',
    'await handle(async (run) => {',
    '  const { scenario } = run.input as { scenario: string };',
    '  try {',
    '    if (scenario !== "batch") {',
    '      const input = scenario === "oversized" ? { instructions: "é".repeat(524289) }',
    '        : scenario === "over-grant" ? { instructions: "é".repeat(150000) }',
    '        : { instructions: "Rejected authority", provider: "package-selected" };',
    '      await run.call({ operationId: scenario, slot: "left", input });',
    '      return { outcome: "done", output: { status: "unexpected-dispatch" } };',
    '    }',
    `    const results = await Promise.all(["left", "right"].map(async (lane) => run.call({`,
    '      operationId: lane, slot: lane, input: {',
    '        instructions: "Return the lane from explicit guidance as JSON.",',
    '        guidance: [{ label: "lane", text: lane }], skills: [{ name: "answer-check", files: [{ path: "SKILL.md", text: await Bun.file(new URL("./skills/answer-check/SKILL.md", import.meta.url)).text() }] }],',
    '        responseSchema: { $schema: "https://flow.jig.md/schemas/schema-0.json", type: "object",',
    '          properties: { lane: { type: "string", enum: [lane] } }, required: ["lane"], additionalProperties: false },',
    '      },',
    '    })));',
    '    return { outcome: "done", output: { status: "succeeded", results, parentHasKey: process.env.METHOD_TEST_TOKEN !== undefined } };',
    '  } catch (error) {',
    '    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";',
    '    return { outcome: "done", output: { status: "failed", code } };',
    '  }',
    '});',
  ].join('\n')
}

/** Installed artifacts are ordinary workspace members; application source stays unchanged. */
export async function writeRepairWorkspace(
  root: string,
  url: string,
  batch = false,
): Promise<void> {
  const project = join(root, 'project')
  await cp(join(testRoot, '../../../examples/tested-patch'), project, {
    recursive: true,
    filter: (source) => !['node_modules', '.jig', 'jig.lock'].includes(basename(source)),
  })
  if (batch) {
    await addBatchRepairFixture(project)
    // Only the private batch root uses retention; the public single-job root does not.
    await writeFile(
      join(project, 'flows/project/FLOW.meta.json'),
      JSON.stringify({
        name: 'batch-repair-fixture',
        uses: { repair: {}, progress: { contract: './contracts/run-checkpoint/contract.json' } },
      }),
    )
  }
  await writeOrdinaryAgent(project, {
    url,
    api: 'responses',
    model: 'local-fixed-response',
  })
  // Replace the application's selected Agent Binding, not its default map or
  // method source. Leaving the original Pi grant would still require that client.
  await rename(join(project, 'bindings/method.ts'), join(project, 'bindings/agent.ts'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['project', 'project/flows/*', 'packages/*'] }),
  )
  for (const [name, variable] of [
    ['flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE'],
    ['reporting', 'REPORTING_PACKAGE_ARCHIVE'],
    ['agent-acp', 'AGENT_ACP_PACKAGE_ARCHIVE'],
  ] as const) {
    const destination = join(root, 'packages', name)
    const artifacts = join(root, 'artifacts', name)
    await mkdir(destination, { recursive: true })
    await mkdir(artifacts, { recursive: true })
    let archive = process.env[variable]
    if (archive === undefined) {
      const pack = Bun.spawn(
        [
          process.execPath,
          '--no-env-file',
          'pm',
          'pack',
          '--ignore-scripts',
          '--destination',
          artifacts,
        ],
        {
          cwd: name === 'flow-sdk' ? flowSdkDirectory : join(testRoot, '../..', name),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [code, stdout, stderr] = await Promise.all([
        pack.exited,
        new Response(pack.stdout).text(),
        new Response(pack.stderr).text(),
      ])
      expect(code, `${stdout}\n${stderr}`).toBe(0)
      const files = (await readdir(artifacts)).filter((file) => file.endsWith('.tgz'))
      expect(files).toHaveLength(1)
      archive = join(artifacts, files[0]!)
    }
    archive = await realpath(archive)
    const extract = Bun.spawn(['tar', '-xzf', archive, '--strip-components=1', '-C', destination], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      extract.exited,
      new Response(extract.stdout).text(),
      new Response(extract.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
  }
  const lock = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--lockfile-only',
      '--ignore-scripts',
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  const [code, stdout, stderr] = await Promise.all([
    lock.exited,
    new Response(lock.stdout).text(),
    new Response(lock.stderr).text(),
  ])
  expect(code, `${stdout}\n${stderr}`).toBe(0)
}

/** Fixed local-only workspace: installed aliases and module-relative resources, no registry. */
export async function writeSkillWorkspace(root: string, nested: boolean): Promise<void> {
  const library = join(root, 'libs/context')
  await mkdir(join(library, 'skills/selected'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      private: true,
      workspaces: nested
        ? ['flows/router', 'flows/parent', 'libs/context']
        : ['flows/router', 'libs/context'],
    }),
  )
  await writeFile(
    join(library, 'package.json'),
    JSON.stringify({
      name: 'skill-context',
      version: '1.0.0',
      type: 'module',
      exports: './index.ts',
    }),
  )
  await writeFile(
    join(library, 'index.ts'),
    'export const marker = { text: await Bun.file(new URL("./marker.txt", import.meta.url)).text() };\n',
  )
  await writeFile(join(library, 'marker.txt'), 'CAPTURED_WORKSPACE_CONTEXT')
  await writeFile(join(library, 'skills/selected/SKILL.md'), 'DEPENDENCY_SKILL_MUST_NOT_LEAK')
  for (const member of nested ? ['router', 'parent'] : ['router']) {
    const flow = join(root, 'flows', member)
    await writeFile(
      join(flow, 'package.json'),
      JSON.stringify({
        name: `skill-${member}`,
        private: true,
        type: 'module',
        dependencies: { 'skill-context': 'workspace:*' },
      }),
    )
    const program = await readFile(join(flow, 'FLOW.ts'), 'utf8')
    await writeFile(
      join(flow, 'FLOW.ts'),
      [
        'import { marker } from "skill-context";',
        'import { marker as canonicalMarker } from "../../libs/context/index.ts";',
        'if (marker !== canonicalMarker || marker.text !== "CAPTURED_WORKSPACE_CONTEXT")',
        '  throw new Error("workspace module identity or retained resource changed");',
        program.replace(/^#![^\n]*\n/, ''),
      ].join('\n'),
    )
  }
  const lock = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '--config=/dev/null',
      'install',
      '--lockfile-only',
      '--ignore-scripts',
    ],
    { cwd: root, env: {}, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exit, stdout, stderr] = await Promise.all([
    lock.exited,
    new Response(lock.stdout).text(),
    new Response(lock.stderr).text(),
  ])
  expect(exit, `${stdout}\n${stderr}`).toBe(0)
}

export async function writeSpecialistParent(root: string): Promise<void> {
  const parent = join(root, 'flows', 'parent')
  const specialist = join(root, 'flows', 'router')
  await mkdir(join(parent, 'flow-sdk'), { recursive: true })
  await mkdir(join(root, 'bindings'))
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'bindings', 'parent.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({ package: "flows/parent", settings: { profile: "parent" },',
      '  slots: { direct: "flow:flows/router", configured: "binding:specialist" } });',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'bindings', 'specialist.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({ package: "flows/router", settings: { profile: "specialist" } });',
    ].join('\n'),
  )
  const settingsSchema = JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/schema-0.json',
    type: 'object',
    properties: { profile: { type: 'string' } },
    additionalProperties: false,
  })
  await writeFile(join(parent, 'settings.schema.json'), settingsSchema)
  await writeFile(join(specialist, 'settings.schema.json'), settingsSchema)
  await writeFile(
    join(parent, 'FLOW.meta.json'),
    JSON.stringify({ name: 'parent', description: 'Calls an exact Agent specialist.' }),
  )
  await writeFile(
    join(parent, 'FLOW.ts'),
    [
      'import { handle } from "./flow-sdk/index.js";',
      'await handle(async (run) => {',
      '  const input = run.input as { scenario: string; direct?: boolean };',
      '  return await run.call({ operationId: `agent:${input.scenario}`,',
      '    slot: input.direct ? "direct" : "configured", input: { scenario: input.scenario } });',
      '});',
    ].join('\n'),
  )
  for (const name of await readdir(join(specialist, 'flow-sdk'))) {
    await copyFile(join(specialist, 'flow-sdk', name), join(parent, 'flow-sdk', name))
  }
}

export function flowProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'async function selectedSkills() {',
    '  const root = new URL("./skills/selected/", import.meta.url);',
    '  const files = [];',
    '  for await (const path of new Bun.Glob("**/*").scan({cwd: root.pathname, onlyFiles: true}))',
    '    files.push({path, text: await Bun.file(new URL(path, root)).text()});',
    '  return [{name: "selected", files}];',
    '}',
    'const responseSchema = {',
    '  $schema: "https://flow.jig.md/schemas/schema-0.json", type: "object",',
    '  properties: {',
    '    decision: { type: "object", properties: {',
    '      route: { type: "string", enum: ["technical"] },',
    '      evidence: { type: "array", minItems: 1, maxItems: 1, items: {',
    '        type: "object", properties: {',
    '          keyLocation: { type: "string", enum: ["stdin"] },',
    '          selectedSkill: { type: "string", enum: ["present"] },',
    '          hiddenSkill: { type: "string", enum: ["absent"] },',
    '          sourceLine: { type: "integer" }, amount: { type: ["integer", "null"] },',
    '        }, required: ["keyLocation", "selectedSkill", "hiddenSkill", "sourceLine", "amount"],',
    '        additionalProperties: false,',
    '      } },',
    '      ambiguity: { type: ["string", "null"] },',
    '    }, required: ["route", "evidence", "ambiguity"], additionalProperties: false },',
    '  },',
    '  required: ["decision"],',
    '  additionalProperties: false,',
    '};',
    'await handle(async (run) => {',
    '  const input = run.input as { scenario: string };',
    '  try {',
    '    const agent = await run.call({',
    '      operationId: `agent:${input.scenario}`, slot: "agent",',
    '      input: { instructions: input.scenario === "api-structured"',
    '        ? "Return only JSON matching the response schema. Set route to technical, evidence to one item with keyLocation stdin, selectedSkill present, hiddenSkill absent, sourceLine 1, and amount null; set ambiguity to null."',
    '        : input.scenario === "api-text" ? "Reply with exactly READY and nothing else."',
    '        : `scenario:${input.scenario}. Return sourceLine 1, amount null, and ambiguity null.`, skills: await selectedSkills(),',
    '        ...(input.scenario === "api-text" ? {} : {',
    '          responseSchema: input.scenario === "schema-input-invalid"',
    '            ? { $schema: "https://flow.jig.md/schemas/schema-0.json", type: "unknown" }',
    '            : responseSchema,',
    '        }) },',
    '    });',
    '    return { outcome: "done", output: { status: "succeeded", agent, settings: run.settings,',
    '      parentHasKey: process.env.METHOD_TEST_TOKEN !== undefined || process.env.OPENAI_API_KEY !== undefined ||',
    '        process.env.ANTHROPIC_API_KEY !== undefined ||',
    '        process.env.ANTHROPIC_AUTH_TOKEN !== undefined ||',
    '        process.env.PI_API_KEY !== undefined } };',
    '  } catch (error) {',
    '    const code = typeof error === "object" && error !== null && "code" in error',
    '      ? String((error as { code: unknown }).code) : "UNKNOWN";',
    '    return { outcome: "done", output: { status: "failed", code } };',
    '  }',
    '});',
    '',
  ].join('\n')
}

export function runRequest(submissionId: string, scenario: string, nested = false) {
  return Object.freeze({
    submissionId,
    target: nested
      ? { kind: 'binding' as const, id: 'parent' }
      : { kind: 'flow' as const, path: 'flows/router' },
    input: { scenario },
  })
}

export async function runToTerminal(
  administration: RootAdministration,
  submissionId: string,
  scenario: string,
  timeoutMs = process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 30_000,
  nested = false,
) {
  const receipt = await administration.startRun(runRequest(submissionId, scenario, nested))
  return await waitForTerminal(administration, receipt, timeoutMs)
}

export function agentText(terminal: Awaited<ReturnType<typeof waitForTerminal>>): string {
  const output =
    terminal.state === 'terminal' && terminal.terminal.status === 'succeeded'
      ? terminal.terminal.output
      : undefined
  const agent =
    output !== null && typeof output === 'object' && 'agent' in output ? output.agent : undefined
  const response =
    agent !== null && typeof agent === 'object' && 'output' in agent ? agent.output : undefined
  if (
    typeof response !== 'object' ||
    response === null ||
    !('text' in response) ||
    typeof response.text !== 'string'
  ) {
    throw new Error('native Agent result omitted its text')
  }
  return response.text
}

export async function waitForTerminal(
  administration: RootAdministration,
  receipt: StartRootRunReceipt,
  timeoutMs = process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 30_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  const finalStatus = await administration.runStatus(receipt)
  if (finalStatus.state === 'terminal') return finalStatus
  throw new Error(`Agent fixture Run did not become terminal: ${JSON.stringify(finalStatus)}`)
}

export async function waitForAgentSandbox(
  root: string,
  runId: string,
  expectedOwners = 1,
  timeoutMs = process.platform === 'darwin' ? 60_000 : 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const count = withStore(root, (database) =>
        Number(
          database
            .query(
              [
                'SELECT count(*) AS count FROM root_child_owners',
                'WHERE parent_run_id = ?1 AND sandbox_digest IS NOT NULL',
              ].join(' '),
            )
            .get(runId).count,
        ),
      )
      if (count === expectedOwners) return
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'SQLITE_BUSY') throw error
    }
    await Bun.sleep(20)
  }
  const state = withStore(root, (database) => ({
    owners: database
      .query(
        'SELECT scope_operation_id, operation_id, sandbox_digest IS NOT NULL AS sealed FROM root_child_owners WHERE parent_run_id = ?1',
      )
      .all(runId),
    terminal: database
      .query(
        'SELECT CAST(terminal_bytes AS TEXT) AS terminal FROM root_terminals WHERE run_id = ?1',
      )
      .get(runId),
  }))
  throw new Error(`Agent fixture did not retain its sandbox owner: ${JSON.stringify(state)}`)
}

export async function expectNoAgentOwner(root: string): Promise<void> {
  expect(
    withStore(root, (database) =>
      Number(database.query('SELECT count(*) AS count FROM root_child_owners').get().count),
    ),
  ).toBe(0)
  const path = join(root, '.jig', 'private-root-owners')
  const values = await readdir(path).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[]
    throw error
  })
  expect(values.filter((value) => /^(a-|c-|x-)/.test(value))).toEqual([])
  const materializations = await readdir(join(root, '.jig', 'private-root-materializations'))
  expect(materializations.filter((value) => value.startsWith('child-'))).toEqual([])
}

export function withStore<Value>(root: string, use: (database: any) => Value): Value {
  const sqlite = createRequire(import.meta.url)('bun:sqlite') as any
  const database = sqlite.Database.open(
    join(root, '.jig', 'jig.sqlite3'),
    sqlite.constants.SQLITE_OPEN_READONLY | sqlite.constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    return use(database)
  } finally {
    database.close(true)
  }
}

export async function dispatchServer(
  events: DispatchEvent[],
  key: string,
  acp: boolean,
): Promise<Server> {
  const server = createServer(async (request, response) => {
    try {
      if (
        request.method !== 'POST' ||
        request.url !== (acp ? '/dispatch' : '/v1/responses') ||
        request.headers.authorization !== `Bearer ${key}`
      ) {
        response.writeHead(404).end()
        return
      }
      const text = await new Response(request as any).text()
      if (acp) {
        events.push(JSON.parse(text) as DispatchEvent)
        response.writeHead(204).end()
        return
      }
      const body = JSON.parse(text)
      if (
        body.stream !== false ||
        body.store !== false ||
        body.max_output_tokens !== 4096 ||
        typeof body.input !== 'string'
      )
        throw new Error('invalid request controls')
      const prompt = body.input as string
      const scenario = ['schema-invalid', 'malformed', 'recovery', 'success', 'slow'].find(
        (value) => prompt.includes(`scenario:${value}`),
      )
      if (scenario === undefined) throw new Error('missing fixture scenario')
      events.push({
        scenario,
        selectedSkill: prompt.includes('SELECTED_SKILL_MARKER'),
        hiddenSkill: prompt.includes('HIDDEN_SKILL_MARKER'),
      })
      // Keep the request pending until the owned HTTP worker is cancelled/fenced.
      if (scenario === 'slow' || scenario === 'recovery') return
      if (scenario === 'malformed') {
        response.writeHead(200).end('not-json')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify(
          completedResponse(
            JSON.stringify({
              ...EXPECTED_STRUCTURED_AGENT_RESULT,
              decision: {
                ...EXPECTED_STRUCTURED_AGENT_RESULT.decision,
                route: scenario === 'schema-invalid' ? 'invalid' : 'technical',
              },
            }),
          ),
        ),
      )
    } catch {
      response.writeHead(400).end()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  return server
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
    server.closeAllConnections()
  })
}

export async function waitForEvents(
  events: readonly DispatchEvent[],
  scenario: string,
  count: number,
): Promise<void> {
  const deadline = Date.now() + (process.platform === 'darwin' ? 60_000 : 10_000)
  while (Date.now() < deadline) {
    if (events.filter((event) => event.scenario === scenario).length >= count) return
    await Bun.sleep(20)
  }
  throw new Error(`Agent fixture did not report ${scenario} dispatch`)
}

export async function treeContains(root: string, needle: string): Promise<boolean> {
  const encoded = Buffer.from(needle)
  for (const relative of await readdir(root, { recursive: true })) {
    const path = join(root, relative)
    const information = await lstat(path)
    if (information.isFile() && Buffer.from(await readFile(path)).includes(encoded)) return true
  }
  return false
}

export async function rootlessCgroups(): Promise<string[]> {
  if (process.platform === 'darwin') return []
  const delegated = process.env.AGENT_DELEGATED_CGROUP
  if (delegated === undefined) {
    if (HOSTILE) throw new Error('Agent lifecycle proof has no delegated cgroup')
    return []
  }
  return (await readdir(delegated)).filter((entry) => entry.startsWith('jig-run-')).sort()
}

export async function waitForCgroups(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (sameMembers(await rootlessCgroups(), expected)) return
    await Bun.sleep(20)
  }
  throw new Error('Agent lifecycle proof left cgroup residue')
}

export function rootlessTemporaryEntry(entry: string): boolean {
  return (
    entry.startsWith('jig-rootless-control-') ||
    entry.startsWith('jig-rootless-owner-') ||
    entry.startsWith('jig-rootless-devices-')
  )
}

export function nativePublicCommandEnvironment(options: {
  readonly codexPath: string
  readonly apiKey: string
  readonly model: string
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: requiredProcessEnvironment('PATH'),
    HOME: requiredProcessEnvironment('HOME'),
    CODEX_PATH: options.codexPath,
    OPENAI_API: 'responses',
    OPENAI_API_KEY: options.apiKey,
    OPENAI_BASE_URL: OPENROUTER_RESPONSES_TEST_BASE_URL,
    OPENAI_MODEL: options.model,
  }
  for (const key of ['TMPDIR', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

export function requiredProcessEnvironment(key: string): string {
  const value = process.env[key]
  if (value === undefined || value.length === 0)
    throw new Error(`native installed-package qualification requires ${key}`)
  return value
}

export async function runInstalledJigCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly credentialLeaked: boolean
}> {
  const child = Bun.spawn([command, ...args], {
    cwd,
    env: environment,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  let forceTimer: ReturnType<typeof setTimeout> | undefined
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill('SIGINT')
    forceTimer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  }, timeoutMs)
  let exitCode: number
  let stdout: string
  let stderr: string
  try {
    ;[exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
  } finally {
    clearTimeout(timeout)
    if (forceTimer !== undefined) clearTimeout(forceTimer)
  }
  const credential = environment.OPENAI_API_KEY
  const credentialLeaked =
    credential !== undefined && (stdout.includes(credential) || stderr.includes(credential))
  if (credential !== undefined) {
    stdout = stdout.replaceAll(credential, '[redacted]')
    stderr = stderr.replaceAll(credential, '[redacted]')
  }
  if (timedOut)
    throw new Error(
      `installed Jig command exceeded ${timeoutMs}ms: ${args.join(' ')}\n${stdout}${stderr}`,
    )
  return { exitCode, stdout, stderr, credentialLeaked }
}

export async function waitForTemporaryState(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry)
    if (sameMembers(current, expected)) return
    await Bun.sleep(20)
  }
  throw new Error('Agent lifecycle proof left temporary owner residue')
}

export function sameMembers(values: readonly string[], expected: ReadonlySet<string>): boolean {
  return (
    values.every((value) => expected.has(value)) &&
    [...expected].every((value) => values.includes(value))
  )
}

export async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const text = new TextDecoder()
  let buffered = ''
  try {
    while (true) {
      const value = await reader.read()
      if (value.done) throw new Error('Agent coordinator fixture exited before its receipt')
      buffered += text.decode(value.value, { stream: true })
      const newline = buffered.indexOf('\n')
      if (newline !== -1) return buffered.slice(0, newline)
    }
  } finally {
    reader.releaseLock()
  }
}
export async function qualifyRepairScenario(
  scenario: 'successful' | 'unsuccessful' | 'batch' | 'mixed-batch',
  temporaryRoot: string,
): Promise<void> {
  const root = await mkdtemp(join(temporaryRoot, 'jig-repair-file-proof-'))
  const project = join(root, 'project'),
    release = join(root, 'release'),
    out = join(root, 'review')
  const fixture = join(testRoot, '../../../examples/tested-patch/fixtures/log-report')
  const originalParse = await readFile(join(fixture, 'src/parse.ts'), 'utf8')
  const originalReport = await readFile(join(fixture, 'src/report.ts'), 'utf8')
  const replacements = [
    {
      path: 'src/parse.ts',
      content: originalParse.replace(
        "typeof value.status !== 'number'",
        '!Number.isInteger(value.status) || value.status < 100 || value.status > 599',
      ),
    },
    {
      path: 'src/report.ts',
      content: originalReport.replace('r.status >= 400).length', 'r.status >= 500).length'),
    },
  ]
  const timesheetFixture = join(testRoot, 'fixtures/repair-batch/fixtures/timesheet')
  const originalTime = await readFile(join(timesheetFixture, 'src/parse.ts'), 'utf8')
  const originalTotal = await readFile(join(timesheetFixture, 'src/total.ts'), 'utf8')
  const timesheetReplacements = [
    {
      path: 'src/parse.ts',
      content: originalTime.replace('hour > 23', 'hour > 23 || minute > 59'),
    },
    {
      path: 'src/total.ts',
      content: originalTotal.replace(
        'Math.max(0, shift.end - shift.start)',
        '(shift.end - shift.start + 1440) % 1440',
      ),
    },
  ]
  let calls = 0
  let verified = false
  const batchScenario = scenario === 'batch' || scenario === 'mixed-batch'
  const repairPasses = scenario !== 'unsuccessful'
  const server = createServer(async (request, response) => {
    const requestText = await new Response(request as any).text()
    const selectedReplacements = requestText.includes('src/total.ts')
      ? timesheetReplacements
      : replacements
    calls++
    if (scenario === 'mixed-batch' && requestText.includes('src/total.ts')) {
      response
        .writeHead(503, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'Bounded fixture refusal.' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify(
        completedResponse(
          JSON.stringify({
            replacements: repairPasses ? selectedReplacements : [selectedReplacements[1]],
            summary: 'Apply the two source corrections and keep all acceptance checks unchanged.',
          }),
        ),
      ),
    )
  })
  const owner = new PrivateFileDeliveryOwner(new AbortController().signal)
  let checkpoints: PrivateRunCheckpoints | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no local fixture endpoint')
    await mkdir(release)
    const location = await timeFixturePhase(`repair-${scenario}`, 'installed-support', () =>
      writeInstalledFixture(release),
    )
    await timeFixturePhase(`repair-${scenario}`, 'project-construct', () =>
      writeRepairWorkspace(root, `http://127.0.0.1:${address.port}/v1/responses`, batchScenario),
    )
    let stdout = '',
      stderr = ''
    const options = {
      currentDirectory: project,
      interactive: false,
      writeOutput: (text: string) => {
        stdout += text
      },
      writeError: (text: string) => {
        stderr += text
      },
      host: {
        acquire: async (
          directory: string,
          options?: {
            runTimeoutMs?: number
            files?: import('../../src/internal/root-run-files.js').PrivateRootRunFiles
          },
        ) =>
          openPrivateProjectSession({
            directory,
            host: {
              ...(await openPrivateInstalledBunHost(
                location,
                {
                  METHOD_TEST_TOKEN: 'synthetic-no-remote-credential',
                },
                directory,
              )),
              ...options,
            },
            onOperationFailure: (evidence) =>
              console.error('repair-operation-failure', JSON.stringify(evidence)),
            onRootExecutionFailure: (evidence) =>
              console.error('repair-root-execution-failure', JSON.stringify(evidence)),
          }),
        delivery: {
          get checkpoint() {
            return checkpoints?.latest ?? null
          },
          bindCheckpoint: async (identity: RunCheckpointIdentity) => {
            checkpoints = new PrivateRunCheckpoints(identity)
          },
          saveCheckpoint: async (input: RunCheckpointInput) => checkpoints!.accept(input),
          retire: async () => {
            checkpoints?.close()
            await owner.close()
          },
          prepare: (directory: string, roots: readonly number[]) => owner.prepare(directory, roots),
          publish: async (
            record: import('../../src/json.js').JsonValue,
            output: PrivateExecutionOutput | undefined,
          ) =>
            owner.publish(
              { ...(record as any), checkpoint: checkpoints?.latest ?? null },
              output === undefined
                ? undefined
                : output.kind === 'linux-directory'
                  ? { kind: 'linux-directory', fd: output.directory.fd }
                  : { kind: 'snapshot', capture: await repairOutputCapture(output.ready) },
              checkpoints?.latest ?? undefined,
              true,
            ),
        },
      },
    }
    // Match the installed entrypoint: one verification scope per command,
    // with its cache outside the actual consumer project.
    const runCommand = (args: readonly string[]) =>
      timeFixturePhase(`repair-${scenario}`, args[0] === 'review' ? 'review' : 'run', () =>
        withPrivateInstallationVerification(
          { XDG_CACHE_HOME: join(root, 'verification-cache') },
          () => main(args, options),
        ),
      )
    expect(await runCommand(['review', '--yes', '--allow-authority-changes']), stderr).toBe(0)
    stdout = ''
    stderr = ''
    const before = await readFile(join(project, 'fixtures/log-report/src/parse.ts'))
    if (scenario === 'successful') {
      expect(
        await runCommand([
          'run',
          'binding:repair',
          '--input',
          '@issue.json',
          '--attach',
          'source=fixtures/log-report',
          '--out',
          out,
          '--timeout',
          process.platform === 'darwin' ? '5m' : '120s',
        ]),
        stdout + stderr,
      ).toBe(0)
      const record = JSON.parse(stdout)
      expect(record).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        delivery: { status: 'written' },
      })
      expect(await readFile(join(out, 'files/review/summary.txt'), 'utf8')).toContain(
        'review-ready',
      )
      expect(await readFile(join(out, 'files/review/goal.txt'), 'utf8')).toBe(
        JSON.parse(await readFile(join(project, 'issue.json'), 'utf8')).issue + '\n',
      )
      expect(await readFile(join(out, 'files/review/review.patch'), 'utf8')).toContain(
        '--- a/src/parse.ts',
      )
      expect(await readFile(join(out, 'files/review/review.patch'), 'utf8')).toContain(
        '--- a/src/report.ts',
      )
      expect(record.output.baseline.acceptance.filter((c: any) => !c.passed)).toHaveLength(3)
      expect(record.output.attempts[0].evaluation.acceptance.every((c: any) => c.passed)).toBe(true)
      expect(record.output.attempts[0].evaluation.commands[0].exitCode).toBe(0)
      expect(JSON.parse(await readFile(join(out, 'result.json'), 'utf8'))).toEqual(record)
      expect(await readFile(join(project, 'fixtures/log-report/src/parse.ts'))).toEqual(before)
      expect(await readFile(join(project, 'fixtures/log-report/src/report.ts'), 'utf8')).toEqual(
        originalReport,
      )
      expect(calls).toBe(1)
    }
    if (scenario === 'unsuccessful') {
      const failedOut = join(root, 'unsuccessful')
      expect(
        await runCommand([
          'run',
          'binding:repair',
          '--input',
          '@issue.json',
          '--attach',
          'source=fixtures/log-report',
          '--out',
          failedOut,
          '--timeout',
          process.platform === 'darwin' ? '5m' : '120s',
        ]),
        stdout + stderr,
      ).toBe(0)
      const unsuccessful = JSON.parse(stdout)
      expect(unsuccessful).toMatchObject({
        status: 'succeeded',
        outcome: 'blocked',
        delivery: { status: 'written' },
      })
      expect(unsuccessful.output.attempts).toHaveLength(2)
      expect(unsuccessful.output.attempts.every((a: any) => a.evaluation.accepted === false)).toBe(
        true,
      )
      expect((await readdir(join(failedOut, 'files/review'))).sort()).toEqual([
        'goal.txt',
        'proposal-1.patch',
        'proposal-2.patch',
        'summary.txt',
      ])
      expect(await readFile(join(project, 'fixtures/log-report/src/parse.ts'))).toEqual(before)
      expect(calls).toBe(2)
    }
    if (batchScenario) {
      const batchOut = join(root, 'batch')
      expect(
        await runCommand([
          'run',
          'binding:repair',
          '--input',
          '@batch.json',
          '--attach',
          'source=fixtures',
          '--out',
          batchOut,
          '--timeout',
          process.platform === 'darwin' ? '5m' : '180s',
        ]),
        stdout + stderr,
      ).toBe(0)
      const batch = JSON.parse(stdout)
      expect(batch).toMatchObject({
        status: 'succeeded',
        outcome: scenario === 'mixed-batch' ? 'blocked' : 'done',
        delivery: { status: 'written' },
      })
      expect(batch.output.overlaps).toEqual([])
      expect(batch.output.jobs).toHaveLength(2)
      expect(new Set(batch.output.jobs.map((job: any) => job.baseDigest)).size).toBe(2)
      for (const job of batch.output.jobs) {
        if (scenario === 'mixed-batch' && job.id === 'timesheet') {
          expect(job).toMatchObject({ status: 'failed' })
          expect(job.ready).toBeUndefined()
          expect(await Bun.file(join(batchOut, 'files', job.id, 'review.patch')).exists()).toBe(
            false,
          )
          continue
        }
        expect(job).toMatchObject({ status: 'settled', ready: true })
        expect(job.result.output.baseline.acceptance.some((c: any) => !c.passed)).toBe(true)
        expect(
          job.result.output.attempts[0].evaluation.acceptance.every((c: any) => c.passed),
        ).toBe(true)
        expect(job.result.output.attempts[0].evaluation.commands[0].exitCode).toBe(0)
        const patch = await readFile(join(batchOut, 'files', job.id, 'review.patch'), 'utf8')
        expect(patch).toContain('--- a/src/parse.ts')
        expect(patch).toContain(job.id === 'logs' ? '--- a/src/report.ts' : '--- a/src/total.ts')
      }
      expect(await readFile(join(project, 'fixtures/log-report/src/parse.ts'))).toEqual(before)
      expect(await readFile(join(project, 'fixtures/timesheet/src/parse.ts'), 'utf8')).toBe(
        originalTime,
      )
      expect(await readFile(join(project, 'fixtures/timesheet/src/total.ts'), 'utf8')).toBe(
        originalTotal,
      )
      expect(calls).toBe(2)
      expect(batch.checkpoint.evidence.pending).toEqual([])
      expect(batch.checkpoint.files['logs/review.patch']).toContain('--- a/src/parse.ts')
      expect(await readFile(join(batchOut, 'files/summary.txt'), 'utf8')).toContain(
        'logs: review-ready',
      )
      if (scenario === 'mixed-batch') {
        expect(batch.checkpoint.files['timesheet/review.patch']).toBeUndefined()
        expect(await readFile(join(batchOut, 'files/summary.txt'), 'utf8')).toContain(
          'timesheet: unsuccessful',
        )
      }
    }
    verified = true
  } finally {
    let cleaned = false
    try {
      await timeFixturePhase(`repair-${scenario}`, 'delivery-close', () => owner.close())
      cleaned = true
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      if (verified && cleaned) await rm(root, { recursive: true, force: true })
      else console.error(`Repair proof retained at ${root}`)
    }
  }
  // Each case owns one bounded Run. Leave setup/cleanup time outside its
  // execution budget. Mac uses the documented five-minute repair invocation.
}

export async function qualifyAgentFence(
  nested: boolean,
  acp: boolean,
  temporaryRoot: string,
  initialCgroups: ReadonlySet<string>,
  initialTemporaryState: ReadonlySet<string>,
): Promise<void> {
  const root = await mkdtemp(join(temporaryRoot, 'jig-agent-lifecycle-project-'))
  const releaseRoot = await mkdtemp(join(temporaryRoot, 'jig-agent-lifecycle-release-'))
  const events: DispatchEvent[] = []
  const key = `synthetic-bearer-${basename(root)}`
  const server = await dispatchServer(events, key, acp)
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    if (
      name.startsWith('OPENAI_') ||
      name.startsWith('OPENROUTER_') ||
      name === 'ACP_TEST_ENDPOINT'
    )
      delete environment[name]
  }
  let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
  let primaryFailure: unknown
  let verified = false
  const request = (id: string, scenario: string) => runRequest(id, scenario, nested)
  const run = (
    id: string,
    scenario: string,
    timeoutMs = process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 30_000,
  ) => {
    console.error('agent-lifecycle-scenario', id)
    return runToTerminal(session!.rootAdministration, id, scenario, timeoutMs, nested)
  }
  const waitForSandbox = (runId: string) => waitForAgentSandbox(root, runId, nested ? 3 : 2)
  const onOperationFailure = (evidence: { operation: string; causes: readonly string[] }) =>
    console.error('agent-operation-failure', JSON.stringify(evidence))
  const onRootExecutionFailure = (evidence: { phase: string; causes: readonly string[] }) =>
    console.error('agent-root-execution-failure', JSON.stringify(evidence))
  const openHost = (location: PrivateInstalledBunLocation) =>
    acp
      ? openDeterministicFiniteAcpHost(location, environment, root)
      : openPrivateInstalledBunHost(location, environment, root)
  try {
    const address = server.address()
    if (address === null || typeof address === 'string')
      throw new Error('dispatch server has no port')
    const location = await writeInstalledFixture(releaseRoot)
    await writeProject(root)
    if (nested) await writeSpecialistParent(root)
    environment.METHOD_TEST_TOKEN = key
    if (acp) {
      environment.ACP_TEST_ENDPOINT = `http://127.0.0.1:${address.port}/dispatch`
      await writeDeterministicAcpAgent(releaseRoot)
      await writeOrdinaryAcpAgent(root, 'codex')
    } else
      await writeOrdinaryAgent(root, {
        url: `http://127.0.0.1:${address.port}/v1/responses`,
        api: 'responses',
        default: true,
      })

    session = await openPrivateProjectSession({
      directory: root,
      host: fixtureHost(await openHost(location)),
      onOperationFailure,
      onRootExecutionFailure,
    })
    const plan = await session.plan({ lockMode: 'update' })
    if (plan.state !== 'applicable') throw new Error('Agent fixture did not produce a Plan')
    await session.apply({ planDigest: plan.planDigest, allowAuthorityChanges: true })

    const success = await run('agent-success', 'success')
    expect(success).toMatchObject({
      state: 'terminal',
      terminal: {
        status: 'succeeded',
        outcome: 'done',
        output: {
          status: 'succeeded',
          parentHasKey: false,
          agent: {
            outcome: 'done',
            output: { structured: EXPECTED_STRUCTURED_AGENT_RESULT },
          },
        },
      },
    })
    expect(events).toEqual([
      {
        scenario: 'success',
        ...(acp ? { keyInEnvironment: false } : {}),
        selectedSkill: true,
        hiddenSkill: false,
      },
    ])
    await expectNoAgentOwner(root)
    if (nested) {
      expect(success).toMatchObject({
        terminal: { output: { settings: { profile: 'specialist' } } },
      })
      const direct = await session.rootAdministration.startRun({
        ...request('direct-specialist', 'success'),
        input: { scenario: 'success', direct: true },
      })
      expect(await waitForTerminal(session.rootAdministration, direct)).toMatchObject({
        terminal: { status: 'succeeded', output: { status: 'succeeded', settings: {} } },
      })
      await expectNoAgentOwner(root)
    }

    for (let index = 0; index < 2; index += 1) {
      const repeated = await run(`agent-repeat-${index}`, 'success')
      expect(repeated, JSON.stringify(repeated)).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          outcome: 'done',
          output: {
            status: 'succeeded',
            parentHasKey: false,
            agent: {
              outcome: 'done',
              output: { structured: EXPECTED_STRUCTURED_AGENT_RESULT },
            },
          },
        },
      })
      await expectNoAgentOwner(root)
    }
    expect(events.filter(({ scenario }) => scenario === 'success')).toHaveLength(nested ? 4 : 3)

    for (const scenario of ['schema-invalid', 'malformed']) {
      expect(await run(`agent-${scenario}`, scenario)).toMatchObject({
        state: 'terminal',
        terminal: {
          status: 'succeeded',
          outcome: 'done',
          output: {
            status: 'failed',
            code: acp && scenario === 'malformed' ? 'UNCERTAIN' : 'INVALID_RESULT',
          },
        },
      })
      await expectNoAgentOwner(root)
    }

    const dispatchesBeforeInvalidInput = events.length
    expect(await run('agent-schema-input-invalid', 'schema-input-invalid')).toMatchObject({
      state: 'terminal',
      terminal: {
        status: 'succeeded',
        outcome: 'done',
        output: { status: 'failed', code: 'INVALID_INPUT' },
      },
    })
    expect(events).toHaveLength(dispatchesBeforeInvalidInput)
    await expectNoAgentOwner(root)

    await session.close()
    session = undefined
    const deadlineHost = await openHost(location)
    session = await openPrivateProjectSession({
      directory: root,
      host: Object.freeze({ ...deadlineHost, runTimeoutMs: nested ? 4_000 : 1_500 }),
      onOperationFailure,
      onRootExecutionFailure,
    })
    expect(
      await run(
        'agent-deadline',
        'slow',
        process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 10_000,
      ),
    ).toMatchObject({
      state: 'terminal',
      terminal: { status: 'failed', code: 'DEADLINE_EXCEEDED' },
    })
    await expectNoAgentOwner(root)

    await session.close()
    session = await openPrivateProjectSession({
      directory: root,
      host: fixtureHost(await openHost(location)),
      onOperationFailure,
      onRootExecutionFailure,
    })
    const cancellation = await session.rootAdministration.startRun(
      request('agent-cancellation', 'slow'),
    )
    await waitForSandbox(cancellation.runId)
    await session.close()
    session = await openPrivateProjectSession({
      directory: root,
      host: fixtureHost(await openHost(location)),
      onOperationFailure,
      onRootExecutionFailure,
    })
    expect(
      await session.rootAdministration.startRun(request('agent-cancellation', 'slow')),
    ).toEqual(cancellation)
    expect(await waitForTerminal(session.rootAdministration, cancellation)).toMatchObject({
      state: 'terminal',
      terminal: { status: 'failed', code: 'CANCELLED' },
    })
    await expectNoAgentOwner(root)

    await session.close()
    session = undefined
    const recoveryBefore = events.filter(({ scenario }) => scenario === 'recovery').length
    const crashed = Bun.spawn(
      [
        process.execPath,
        join(testRoot, 'fixtures', 'agent-session-runner.ts'),
        root,
        location.releaseRoot,
        location.executablePath,
        'agent-coordinator-loss',
        acp ? 'acp' : nested ? 'specialist' : 'root',
      ],
      {
        env: environment,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const diagnostics = new Response(crashed.stderr).text()
    let receipt: StartRootRunReceipt
    let failedBeforeCoordinatorExit = false
    try {
      receipt = JSON.parse(await firstLine(crashed.stdout)) as StartRootRunReceipt
      await waitForSandbox(receipt.runId)
      await waitForEvents(events, 'recovery', recoveryBefore + 1)
    } catch (error) {
      failedBeforeCoordinatorExit = true
      throw error
    } finally {
      if (crashed.exitCode === null) crashed.kill('SIGKILL')
      await crashed.exited
      const coordinatorDiagnostics = await diagnostics
      if (failedBeforeCoordinatorExit) {
        const closedFailures = coordinatorDiagnostics
          .split('\n')
          .filter((line) => line.startsWith('agent-coordinator-root-execution-failure '))
          .slice(0, 20)
        console.error('agent-coordinator-root-failures', JSON.stringify(closedFailures))
      }
    }
    expect(await crashed.exited).toBe(137)
    await waitForCgroups(initialCgroups)

    delete environment.METHOD_TEST_TOKEN
    session = await openPrivateProjectSession({
      directory: root,
      host: fixtureHost(await openHost(location)),
      onOperationFailure,
      onRootExecutionFailure,
    })
    expect(
      await session.rootAdministration.startRun(request('agent-coordinator-loss', 'recovery')),
    ).toEqual(receipt)
    expect(await waitForTerminal(session.rootAdministration, receipt)).toMatchObject({
      state: 'terminal',
      terminal: { status: 'lost', code: 'COORDINATOR_LOST' },
    })
    await Bun.sleep(250)
    expect(events.filter(({ scenario }) => scenario === 'recovery')).toHaveLength(
      recoveryBefore + 1,
    )
    await expectNoAgentOwner(root)

    expect(await treeContains(root, key)).toBe(false)
    expect(await treeContains(releaseRoot, key)).toBe(false)
    await session.close()
    session = undefined
    await waitForCgroups(initialCgroups)
    await waitForTemporaryState(initialTemporaryState)
    verified = true
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    await session?.close().catch(() => undefined)
    await closeServer(server)
    if (verified) {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(releaseRoot, { recursive: true, force: true }),
      ]).catch((cleanupFailure) => {
        throw primaryFailure === undefined
          ? cleanupFailure
          : new AggregateError(
              [primaryFailure, cleanupFailure],
              'Agent lifecycle assertion and fixture cleanup failed',
            )
      })
    } else console.error('Agent lifecycle proof retained at', root, releaseRoot)
  }
}

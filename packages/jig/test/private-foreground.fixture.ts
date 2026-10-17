import { flowSdkRuntimeDirectory } from './fixtures/flow-dependency'
import { expect } from 'bun:test'
import { cp, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { RootAdministration, StartRootRunReceipt } from '../src/administration/root.js'

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1'
interface ApplicablePlan {
  readonly kind: string
  readonly state: 'applicable'
  readonly operation: 'admission'
  readonly planDigest: string
  readonly review: { readonly mediaType: string; readonly text: string }
}
interface ForegroundRunResult {
  readonly kind: string
  readonly runs: readonly ForegroundRunEntry[]
}
interface ForegroundRunEntry {
  readonly submissionId: string
  readonly receipt: { readonly runId: string }
  readonly status: unknown
}
async function writeProject(root: string): Promise<void> {
  const worker = join(root, 'flows', 'worker')
  await mkdir(worker, { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(worker, 'FLOW.meta.json'),
    metadata('foreground-worker', 'Returns its input from one contained Bun Run.'),
  )
  await writeFile(
    join(worker, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: {
        type: 'object',
        properties: {
          ticket: { type: 'string' },
          delayMs: { type: 'number', minimum: 0, maximum: 20_000 },
        },
        required: ['ticket'],
        additionalProperties: false,
      },
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: { worker: {} },
            required: ['worker'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    }),
  )

  await writeFile(join(worker, 'FLOW.ts'), bunWorkerProgram())
  await copyFlowSdk(worker)

  const router = join(root, 'flows', 'ticket-router')
  const bug = join(root, 'flows', 'handle-bug')
  const question = join(root, 'flows', 'answer-question')
  const invalidInput = join(root, 'flows', 'invalid-input-child')
  const invalidResult = join(root, 'flows', 'invalid-result-child')
  const executionFailure = join(root, 'flows', 'execution-failure-child')
  const recursive = join(root, 'flows', 'recursive-child')
  const slotPackages = [
    router,
    bug,
    question,
    invalidInput,
    invalidResult,
    executionFailure,
    recursive,
  ]
  for (const directory of slotPackages) await mkdir(directory, { recursive: true })
  await writeFile(join(router, 'FLOW.meta.json'), metadata('ticket-router', 'Routes one ticket.'))
  await writeFile(join(router, 'FLOW.contract.json'), ticketSchema())
  await writeFile(
    join(router, 'settings.schema.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/schema-0.json',
      type: 'object',
      properties: { label: { const: 'parent' } },
      required: ['label'],
      additionalProperties: false,
    }),
  )
  await writeFile(join(router, 'FLOW.ts'), routerProgram())
  await writeFile(join(bug, 'FLOW.meta.json'), metadata('handle-bug', 'Handles one bug.'))
  await writeFile(join(bug, 'FLOW.contract.json'), ticketSchema('bug'))
  await writeFile(join(bug, 'FLOW.ts'), childProgram('bug'))
  await writeFile(
    join(question, 'FLOW.meta.json'),
    metadata('answer-question', 'Answers one question.'),
  )
  await writeFile(join(question, 'FLOW.contract.json'), ticketSchema('question'))
  await writeFile(join(question, 'FLOW.ts'), childProgram('question'))
  await writeFile(
    join(invalidInput, 'FLOW.meta.json'),
    metadata('invalid-input-child', 'Must never start for the invalid test input.'),
  )
  await writeFile(
    join(invalidInput, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      input: {
        type: 'object',
        properties: { allowed: { const: true } },
        required: ['allowed'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(
    join(invalidInput, 'FLOW.ts'),
    throwingChildProgram('invalid input reached child code'),
  )
  await writeFile(
    join(invalidResult, 'FLOW.meta.json'),
    metadata('invalid-result-child', 'Returns a result rejected by its declaration.'),
  )
  await writeFile(
    join(invalidResult, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: { valid: { const: true } },
            required: ['valid'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    }),
  )
  await writeFile(join(invalidResult, 'FLOW.ts'), invalidResultChildProgram())
  await writeFile(
    join(executionFailure, 'FLOW.meta.json'),
    metadata('execution-failure-child', 'Fails after it starts.'),
  )
  await writeFile(
    join(executionFailure, 'FLOW.ts'),
    throwingChildProgram('deliberate child failure'),
  )
  await writeFile(
    join(recursive, 'FLOW.meta.json'),
    metadata('recursive-child', 'Attempts one unavailable child call.'),
  )
  await writeFile(join(recursive, 'FLOW.ts'), recursiveChildProgram())
  for (const directory of slotPackages) await copyFlowSdk(directory)
  const bindings = join(root, 'bindings')
  await mkdir(bindings)
  await writeFile(
    join(bindings, 'ticket-router.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({',
      '  package: "./flows/ticket-router",',
      '  settings: { label: "parent" },',
      '  slots: {',
      '    bug: "flow:flows/handle-bug",',
      '    question: "flow:flows/answer-question",',
      '    "invalid-input": "flow:flows/invalid-input-child",',
      '    "invalid-result": "flow:flows/invalid-result-child",',
      '    "execution-failure": "flow:flows/execution-failure-child",',
      '    recursive: "flow:flows/recursive-child",',
      '  },',
      '});',
      '',
    ].join('\n'),
  )
}
async function writeAgentFreeProject(root: string): Promise<void> {
  const worker = join(root, 'flows', 'worker')
  await mkdir(worker, { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig } from "@jigging/jig";',
      'export default defineJig({ flows: ["./flows/worker"] });',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(worker, 'FLOW.meta.json'),
    metadata('agent-isolation', 'Returns its input without an Agent invocation.'),
  )
  await writeFile(join(worker, 'FLOW.ts'), bunWorkerProgram())
  await copyFlowSdk(worker)
}
async function writeAgentRouterProject(root: string): Promise<void> {
  const router = join(root, 'flows', 'ticket-router')
  const billing = join(root, 'flows', 'billing')
  const technical = join(root, 'flows', 'technical')
  await Promise.all(
    [router, billing, technical, join(root, 'bindings')].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows"), bindings: discover("bindings") });',
      '',
    ].join('\n'),
  )

  await mkdir(join(router, 'contracts'))
  await cp(
    join(import.meta.dir, '../../../docs/jig/spec/contracts/agent-run'),
    join(router, 'contracts/agent-run'),
    { recursive: true },
  )
  await mkdir(join(router, 'skills', 'ticket-routing'), { recursive: true })
  await writeFile(
    join(router, 'skills', 'ticket-routing', 'SKILL.md'),
    "# Ticket routing\n\nCopy the ticket's explicit `route` field exactly.\n",
  )
  await writeFile(
    join(router, 'FLOW.meta.json'),
    JSON.stringify({
      name: 'ticket-router',
      description: 'Uses one Agent choice before calling an exact child.',
      uses: { agent: { contract: './contracts/agent-run/contract.json' } },
    }),
  )
  await writeFile(join(router, 'FLOW.ts'), agentRouterProgram())
  await copyFlowSdk(router)

  for (const [directory, route] of [
    [billing, 'billing'],
    [technical, 'technical'],
  ] as const) {
    await writeFile(
      join(directory, 'FLOW.meta.json'),
      metadata(route, `Handles one ${route} ticket.`),
    )
    await writeFile(
      join(directory, 'FLOW.ts'),
      [
        '#!/usr/bin/env bun',
        'import { handle } from "./flow-sdk/index.js";',
        `await handle(async (run) => ({ outcome: "done", output: { handled: ${JSON.stringify(route)}, input: run.input } }));`,
        '',
      ].join('\n'),
    )
    await copyFlowSdk(directory)
  }
  await writeFile(
    join(root, 'bindings', 'ticket-router.ts'),
    [
      'import { defineBinding } from "@jigging/jig";',
      'export default defineBinding({',
      '  package: "./flows/ticket-router",',
      '  slots: {',
      '    billing: "flow:flows/billing",',
      '    technical: "flow:flows/technical",',
      '  },',
      '});',
      '',
    ].join('\n'),
  )
}
function agentRouterProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'const responseSchema = {',
    '  $schema: "https://flow.jig.md/schemas/schema-0.json",',
    '  type: "object", properties: { decision: {',
    '    type: "object", properties: {',
    '      route: { type: "string", enum: ["billing", "technical"] },',
    '      evidence: { type: "array", minItems: 1, maxItems: 1, items: {',
    '        type: "object", properties: {',
    '          source: { type: "string", enum: ["ticket"] },',
    '          sourceLine: { type: "integer" },',
    '          amount: { type: ["integer", "null"] },',
    '          ambiguity: { type: ["string", "null"] },',
    '        }, required: ["source", "sourceLine", "amount", "ambiguity"], additionalProperties: false,',
    '      } },',
    '    }, required: ["route", "evidence"], additionalProperties: false,',
    '  } }, required: ["decision"], additionalProperties: false,',
    '};',
    'await handle(async (run) => {',
    '  const input = run.input as { route: "billing" | "technical"; ticket: string };',
    '  const agent = await run.call({',
    '    operationId: "choose-route", slot: "agent",',
    '    input: {',
    '      instructions: `Return only JSON matching the response schema. Copy route exactly from this ticket; set evidence to one item with source ticket, sourceLine 1, amount null, and ambiguity null: ${JSON.stringify(input)}`,',
    '      skills: [{ name: "ticket-routing", files: [{path: "SKILL.md", text: await Bun.file(new URL("./skills/ticket-routing/SKILL.md", import.meta.url)).text()}] }], responseSchema,',
    '    },',
    '  }) as { outcome: string; output: { structured?: { decision: {',
    '    route: "billing" | "technical";',
    '    evidence: [{ source: "ticket"; sourceLine: number; amount: number | null; ambiguity: string | null }];',
    '  } } } };',
    '  if (agent.outcome !== "done" || agent.output.structured === undefined) throw new Error("Agent did not choose");',
    '  const decision = agent.output.structured.decision;',
    '  const child = await run.call({',
    '    operationId: "dispatch-route", slot: decision.route, input,',
    '  });',
    '  return { outcome: "done", output: {',
    '    route: decision.route, evidence: decision.evidence, child,',
    '    parentHasKey: process.env.OPENAI_API_KEY !== undefined,',
    '  } };',
    '});',
    '',
  ].join('\n')
}
function metadata(name: string, description: string): string {
  return JSON.stringify({ name, description })
}
function ticketSchema(kind?: 'bug' | 'question'): string {
  return JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
    input: {
      type: 'object',
      properties: {
        scenario: {
          enum: [
            'single',
            'sequential',
            'concurrent',
            'selected-cancel',
            'invalid-input',
            'invalid-result',
            'execution-failure',
            'recursive',
            'slow',
            'fence-uncertain',
          ],
        },
        kind: kind === undefined ? { enum: ['bug', 'question'] } : { const: kind },
        ticket: { type: 'string' },
        delayMs: { type: 'number', minimum: 0, maximum: 25_000 },
        holdUntilSignal: { type: 'boolean' },
      },
      required: kind === undefined ? ['scenario', 'kind', 'ticket'] : ['kind', 'ticket'],
      additionalProperties: false,
    },
  })
}
function routerProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'await handle(async (context) => {',
    '  const input = context.input as { scenario: string; kind: "bug" | "question"; ticket: string };',
    '  await Bun.write(`${context.scratch}/parent-marker`, "parent");',
    '  const call = async (operationId: string, slot: string, childInput: unknown, signal?: AbortSignal) => {',
    '    try {',
    '      const result = await context.call({ operationId, slot, input: childInput as any }, { signal });',
    '      return { status: "succeeded", result };',
    '    } catch (error) {',
    '      const code = typeof error === "object" && error !== null && "code" in error',
    '        ? String((error as { code: unknown }).code) : "UNKNOWN";',
    '      const message = error instanceof Error ? error.message : String(error);',
    '      return { status: "failed", code, message };',
    '    }',
    '  };',
    '  if (input.scenario === "sequential") {',
    '    const children = [',
    '      await context.call({ operationId: "sequential:bug", slot: "bug", input: { kind: "bug", ticket: input.ticket } }),',
    '      await context.call({ operationId: "sequential:question", slot: "question", input: { kind: "question", ticket: input.ticket } }),',
    '    ];',
    '    return { outcome: "done", output: { scenario: input.scenario, children } };',
    '  }',
    '  if (input.scenario === "concurrent") {',
    '    const concurrent = await Promise.all([',
    '      call("concurrent:a", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '      call("concurrent:b", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '      call("concurrent:c", "bug", { kind: "bug", ticket: input.ticket, delayMs: 3000 }),',
    '    ]);',
    '    const after = await context.call({ operationId: "concurrent:after", slot: "question", input: { kind: "question", ticket: input.ticket } });',
    '    return { outcome: "done", output: { scenario: input.scenario, concurrent, after } };',
    '  }',
    '  if (input.scenario === "selected-cancel") {',
    '    const selected = new AbortController();',
    '    const timer = setTimeout(() => selected.abort(), 7000);',
    '    try {',
    '      const children = await Promise.all([',
    '        call("stop:first", "bug", { kind: "bug", ticket: input.ticket, delayMs: 20000 }, selected.signal),',
    '        call("keep:second", "bug", { kind: "bug", ticket: input.ticket, delayMs: 8000 }),',
    '      ]);',
    '      return { outcome: "done", output: { children } };',
    '    } finally { clearTimeout(timer); }',
    '  }',
    '  if (input.scenario === "invalid-input") {',
    '    const observed = await call("errors:input", "invalid-input", { allowed: false });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "invalid-result") {',
    '    const observed = await call("errors:result", "invalid-result", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "execution-failure") {',
    '    const observed = await call("errors:execution", "execution-failure", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "fence-uncertain") {',
    '    const observed = await call("errors:fence", "bug", { kind: "bug", ticket: input.ticket, holdUntilSignal: true });',
    '    const later = await call("errors:later", "question", { kind: "question", ticket: input.ticket });',
    '    return { outcome: "done", output: { scenario: input.scenario, observed, later } };',
    '  }',
    '  if (input.scenario === "recursive") {',
    '    const observed = await call("errors:recursive", "recursive", {});',
    '    return { outcome: "done", output: { scenario: input.scenario, observed } };',
    '  }',
    '  if (input.scenario === "slow") {',
    '    const child = await context.call({ operationId: "slow:1", slot: "bug", input: { kind: "bug", ticket: input.ticket, delayMs: 20_000 } });',
    '    return { outcome: "done", output: { scenario: input.scenario, child } };',
    '  }',
    '  const route = input.kind === "bug" ? "bug" : "question";',
    '  const child = await context.call({',
    '    operationId: "dispatch:1",',
    '    slot: route,',
    '    input,',
    '  });',
    '  return { outcome: "done", output: {',
    '    scenario: input.scenario, route, parentSettings: Object.keys(context.settings).sort(), child,',
    '  } };',
    '});',
    '',
  ].join('\n')
}
function childProgram(kind: 'bug' | 'question'): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'await handle(async (context) => {',
    '  const started = Date.now();',
    '  const input = context.input as { kind: string; ticket: string; delayMs?: number; holdUntilSignal?: boolean };',
    '  const release = input.holdUntilSignal ? new Promise<void>(resolve => process.once("SIGUSR1", resolve)) : undefined;',
    '  const keepAlive = release === undefined ? undefined : setInterval(() => {}, 1000);',
    '  const marker = `${context.scratch}/parent-marker`;',
    '  const parentMarkerVisible = await Bun.file(marker).exists();',
    '  await Bun.write(marker, "child");',
    '  if (release !== undefined) { try { await release; } finally { clearInterval(keepAlive); } }',
    '  if (input.delayMs !== undefined) await Bun.sleep(input.delayMs);',
    `  return { outcome: "done", output: {`,
    `    handled: "${kind}", ticket: input.ticket,`,
    '    settings: Object.keys(context.settings).sort(),',
    '    attachments: Object.keys(context.attachments).sort(),',
    '    parentMarkerVisible,',
    '    started, finished: Date.now(),',
    '  } };',
    '});',
    '',
  ].join('\n')
}
function throwingChildProgram(message: string): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    `await handle(async () => { throw new Error(${JSON.stringify(message)}); });`,
    '',
  ].join('\n')
}
function invalidResultChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'await handle(async () => ({ outcome: "done", output: { valid: false } }));',
    '',
  ].join('\n')
}
function recursiveChildProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    'await handle(async (context) => await context.call({',
    '  operationId: "recursive:inner",',
    '  slot: "not-admitted",',
    '  input: {},',
    '}));',
    '',
  ].join('\n')
}
async function copyFlowSdk(directory: string): Promise<void> {
  const target = join(directory, 'flow-sdk')
  await mkdir(target)
  await cp(flowSdkRuntimeDirectory, target, { recursive: true })
}
async function writeChannelProject(root: string): Promise<void> {
  const flow = join(root, 'flows/worker')
  await mkdir(flow, { recursive: true })
  await cp(flowSdkRuntimeDirectory, join(flow, 'sdk'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    [
      'import { defineJig, discover } from "@jigging/jig";',
      'export default defineJig({ flows: discover("flows") });',
    ].join('\n'),
  )
  await writeFile(
    join(flow, 'FLOW.meta.json'),
    metadata('channel-worker', 'Publish direct progress and retain the separate execution result.'),
  )
  await writeFile(
    join(flow, 'FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      channels: { progress: { direction: 'send', required: false, schema: { type: 'string' } } },
    }),
  )
  await writeFile(
    join(flow, 'FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      const mode = run.input.mode ?? 'console';
      console.log('live:' + mode);
      let recovered = null, sendAfterDisposal = null;
      if (mode === 'recover') {
        const pair = await run.channel({schema:{type:'string'}});
        const stop = new AbortController();
        const reading = pair.receive.next({signal:stop.signal}).catch(error => error.code);
        await Bun.sleep(50);
        stop.abort();
        recovered = await reading;
        await pair.receive.close();
        try { await pair.send.send('late'); } catch (error) { sendAfterDisposal = error.code; }
      }
      if (run.channels.progress) await run.channels.progress.send('working:' + mode);
      if (mode === 'cancel') await Bun.sleep(60_000);
      if (run.channels.progress) await run.channels.progress.close();
      await Bun.sleep(300);
      return {outcome:'done',output:{mode,recovered,sendAfterDisposal}};
    });
  `,
  )
}
async function writeChildChannelProject(root: string): Promise<void> {
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    `
    import { defineJig, discover } from '@jigging/jig';
    export default defineJig({flows:discover('flows'),bindings:discover('bindings')});
  `,
  )
  await writeFile(
    join(root, 'bindings/composition.ts'),
    `
    import { defineBinding } from '@jigging/jig';
    export default defineBinding({package:'./flows/root',slots:{
      worker:'flow:flows/worker',monitor:'flow:flows/monitor',mismatch:'flow:flows/mismatch'
    }});
  `,
  )
  for (const name of ['root', 'worker', 'monitor', 'mismatch']) {
    const directory = join(root, 'flows', name)
    await mkdir(directory, { recursive: true })
    await cp(flowSdkRuntimeDirectory, join(directory, 'sdk'), {
      recursive: true,
    })
    const channels =
      name === 'root'
        ? { progress: { direction: 'send', required: false, schema: { type: 'string' } } }
        : name === 'worker'
          ? {
              progress: { direction: 'send', schema: { type: 'string' } },
              gate: { direction: 'receive', schema: { type: 'null' } },
            }
          : {
              progress: {
                direction: 'receive',
                schema: { type: name === 'mismatch' ? 'number' : 'string' },
              },
              display: { direction: 'send', schema: { type: 'string' } },
            }
    await writeFile(
      join(directory, 'FLOW.meta.json'),
      metadata(`child-channel-${name}`, 'Exercise exact child communication.'),
    )
    await writeFile(
      join(directory, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        channels,
      }),
    )
  }
  await writeFile(
    join(root, 'flows/worker/FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      result: {
        type: 'object',
        properties: {
          outcome: { const: 'done' },
          output: {
            type: 'object',
            properties: {
              completed: { const: true },
              observationLost: { type: ['string', 'null'] },
            },
            required: ['completed', 'observationLost'],
            additionalProperties: false,
          },
        },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
      channels: {
        progress: { direction: 'send', schema: { type: 'string' } },
        gate: { direction: 'receive', schema: { type: 'null' } },
      },
    }),
  )
  await writeFile(
    join(root, 'flows/root/FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      const mode = run.input.mode;
      const progress = await run.channel({schema:{type:'string'}});
      const display = await run.channel({schema:{type:'string'}});
      const gate = await run.channel({schema:{type:'null'}});
      const stop = new AbortController();
      let retained = false, displayIncomplete = null;
      async function closeOffered(endpoint) {
        try { await endpoint.close(); return true; }
        catch(error) { if(error.code !== 'PERMISSION_DENIED') throw error; return false; }
      }
      const showing = (async () => {
        try {
          for await(const line of display.receive) {
            if(run.channels.progress) await run.channels.progress.send(line);
            if(mode === 'monitor-cancel') stop.abort();
            if(line === 'monitor:first' && mode !== 'monitor-cancel' && mode !== 'monitor-fail') {
              await gate.send.send(null); await gate.send.close();
            }
          }
        } catch(error) { displayIncomplete = error.code; }
      })();
      const monitor = run.call({operationId:'monitor',slot:mode === 'mismatch' ? 'mismatch' : 'monitor',
        input:{mode}, channels:{progress:progress.receive,display:display.send}}, {signal:stop.signal})
        .catch(async error => {
          retained = await closeOffered(progress.receive);
          await closeOffered(display.send);
          await gate.send.send(null); await gate.send.close();
          return {error:error.code};
        });
      if(mode === 'early-monitor-fail') await monitor;
      const worker = run.call({operationId:'worker',slot:'worker',input:{mode},channels:{progress:progress.send,gate:gate.receive}})
        .catch(error => ({error:error.code}));
      const results = await Promise.all([worker,monitor]);
      await showing;
      return {outcome:'done',output:{worker:results[0],monitor:results[1],retained,displayIncomplete}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/worker/FLOW.ts'),
    `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      let observationLost = null;
      for(const phase of ['first','last']) {
        try { await run.channels.progress.send(phase); }
        catch(error) { observationLost = error.code; }
        if(run.input.mode === 'root-cancel') await Bun.sleep(60_000);
        if(phase === 'first') {
          // Wait for the sender's clean close, not just its release message.
          // Disposing after one value could race and disconnect that close.
          for await(const _ of run.channels.gate) {}
        }
        await Bun.sleep(500);
      }
      return {outcome:'done',output:{completed:run.input.mode !== 'invalid-result',observationLost}};
    });
  `,
  )
  const monitor = `
    import { handle } from './sdk/index.js';
    await handle(async run => {
      console.log('monitor-started');
      if(run.input.mode === 'early-monitor-fail') throw new Error('monitor failed before producer admission');
      let count = 0, incomplete = null;
      try {
        for await(const phase of run.channels.progress) {
          count++;
          await run.channels.display.send('monitor:' + phase);
          if(run.input.mode === 'monitor-fail') throw new Error('deliberate monitor failure');
        }
      } catch(error) {
        if(run.input.mode === 'monitor-fail') throw error;
        incomplete = error.code;
      }
      return {outcome:'done',output:{count,incomplete}};
    });
  `
  await writeFile(join(root, 'flows/monitor/FLOW.ts'), monitor)
  await writeFile(join(root, 'flows/mismatch/FLOW.ts'), monitor)
}
async function writeBroadcastChannelProject(root: string): Promise<void> {
  await mkdir(join(root, 'bindings'), { recursive: true })
  await writeFile(
    join(root, 'jig.ts'),
    `
    import {defineJig,discover} from '@jigging/jig';
    export default defineJig({flows:discover('flows'),bindings:discover('bindings')});
  `,
  )
  await writeFile(
    join(root, 'bindings/composition.ts'),
    `
    import {defineBinding} from '@jigging/jig';
    export default defineBinding({package:'./flows/root',slots:{worker:'flow:flows/worker',monitor:'flow:flows/monitor'}});
  `,
  )
  for (const name of ['root', 'worker', 'monitor']) {
    const directory = join(root, 'flows', name)
    await mkdir(directory, { recursive: true })
    await cp(flowSdkRuntimeDirectory, join(directory, 'sdk'), {
      recursive: true,
    })
    const channels =
      name === 'root'
        ? { progress: { direction: 'send', delivery: 'broadcast' } }
        : name === 'worker'
          ? {
              events: { direction: 'send', delivery: 'broadcast' },
              credit: { direction: 'receive' },
            }
          : {
              events: { direction: 'receive', delivery: 'broadcast', schema: { type: 'number' } },
              go: { direction: 'receive' },
              ready: { direction: 'send' },
            }
    await writeFile(
      join(directory, 'FLOW.meta.json'),
      metadata(`broadcast-${name}`, 'Exercise isolated broadcast delivery.'),
    )
    await writeFile(
      join(directory, 'FLOW.contract.json'),
      JSON.stringify({
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        channels,
      }),
    )
  }
  await writeFile(
    join(root, 'flows/root/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      const source = await run.channel({delivery:'broadcast'});
      const monitoring = await source.subscribe();
      const recording = await source.subscribe();
      const credit = await run.channel();
      const go = await run.channel();
      const ready = await run.channel();
      const monitor = run.call({operationId:'monitor',slot:'monitor',input:run.input,
        channels:{events:monitoring,go:go.receive,ready:ready.send}});
      for await(const _ of ready.receive) {}
      if(run.input.mode === 'dispose') await monitor;
      const recorded = [];
      const capture = (async () => {
        for await(const value of recording) {
          recorded.push(value);
          await run.channels.progress.send(value);
          await credit.send.send(null);
        }
        await credit.send.close();
      })();
      const worker = await run.call({operationId:'worker',slot:'worker',input:run.input,
        channels:{events:source.send,credit:credit.receive}});
      await capture;
      if(run.input.mode !== 'dispose') { await go.send.send(null); await go.send.close(); }
      const monitored = await monitor;
      return {outcome:'done',output:{worker,monitor:monitored,recorded}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/worker/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      const count = run.input.mode === 'lagged' ? 20 : run.input.mode === 'schema' ? 2 : 1;
      for(let index=0; index<count; index++) {
        await run.channels.events.send(run.input.mode === 'schema' && index === 1 ? 'invalid for monitor' : index);
        await run.channels.credit.next();
        if(run.input.mode === 'cancel') await Bun.sleep(60_000);
      }
      await run.channels.events.close();
      for await(const _ of run.channels.credit) {}
      return {outcome:'done',output:{completed:true,sent:count}};
    });
  `,
  )
  await writeFile(
    join(root, 'flows/monitor/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      await run.channels.ready.send(null); await run.channels.ready.close();
      if(run.input.mode === 'dispose') {
        await run.channels.events.close(); await run.channels.go.close();
        return {outcome:'done',output:{count:0,incomplete:null,disposed:true}};
      }
      for await(const _ of run.channels.go) {}
      let count = 0, incomplete = null;
      try { for await(const _ of run.channels.events) count++; }
      catch(error) { incomplete = error.code; }
      return {outcome:'done',output:{count,incomplete,disposed:false}};
    });
  `,
  )
}
type DatasetPeer = 'normal' | 'fahrenheit' | 'duplicate' | 'unexpected' | 'eof' | 'held'
async function writeChannelConversationProject(root: string, peer: DatasetPeer): Promise<void> {
  await cp(join(import.meta.dir, 'fixtures/channel-conversation'), root, {
    recursive: true,
    filter: (source) => !['node_modules', '.jig', 'jig.lock'].includes(basename(source)),
  })
  // Source-candidate host evidence uses the current SDK in disposable copies;
  // prepared archive qualification separately checks the distribution closure.
  for (const name of ['investigate', 'analysis', 'dataset']) {
    const flow = join(root, 'flows', name)
    await cp(flowSdkRuntimeDirectory, join(flow, 'sdk'), { recursive: true })
    for (const file of await readdir(flow)) {
      if (!file.endsWith('.ts')) continue
      const path = join(flow, file)
      await writeFile(
        path,
        (await readFile(path, 'utf8')).replaceAll("'@jigging/flow'", "'./sdk/index.js'"),
      )
    }
  }
  if (peer === 'normal') return

  if (peer === 'fahrenheit') {
    const path = join(root, 'flows/dataset/contracts/sample-celsius.json')
    const contract = JSON.parse(await readFile(path, 'utf8'))
    contract.id = 'https://example.org/dataset-analysis/sample-fahrenheit'
    contract.semantics =
      'Each celsius field reports degrees Fahrenheit, despite the unchanged field name.'
    await writeFile(path, JSON.stringify(contract))
    const requested = JSON.parse(
      await readFile(join(root, 'flows/investigate/contracts/sample-celsius.json'), 'utf8'),
    )
    expect(contract.item).toEqual(requested.item)
    expect(contract.id).not.toBe(requested.id)
  }
  // Deliberate peers belong to this test, never to the maintained application's
  // public input. Their messages remain shape-valid to exercise domain checks.
  await writeFile(
    join(root, 'flows/dataset/FLOW.ts'),
    `
    import {handle} from './sdk/index.js';
    await handle(async run => {
      console.log('dataset-dispatched');
      const served = [];
      const requests = run.channels.requests[Symbol.asyncIterator]();
      try {
        for (;;) {
          const next = await requests.next();
          if(next.done) break;
          const request = next.value;
          if(${JSON.stringify(peer)} === 'held') {
            console.log('dataset-outstanding');
            await Bun.sleep(60_000);
          }
          if(${JSON.stringify(peer)} === 'eof') {
            await run.channels.replies.close();
            while(!(await requests.next()).done) {}
            return {outcome:'done',output:{served}};
          }
          const sample = run.input.samples.find(value => value.sample === request.sample);
          const reply = {sample:${JSON.stringify(peer)} === 'unexpected' ? 'unrequested' : request.sample,
            celsius:sample.celsius};
          await run.channels.replies.send(reply);
          served.push(request.sample);
          if(${JSON.stringify(peer)} === 'duplicate') await run.channels.replies.send(reply);
        }
        await run.channels.replies.close();
        return {outcome:'done',output:{served}};
      } catch(error) {
        if(error.code !== 'DISCONNECTED') throw error;
        await run.channels.requests.close();
        try { await run.channels.replies.close(); }
        catch(error) { if(error.code !== 'DISCONNECTED') throw error; }
        // This faulty peer has finished emitting; its done flag does not
        // establish protocol correctness or satisfy the root acceptance check.
        return {outcome:'done',output:{served}};
      }
    });
  `,
  )
}
async function invokeChannelCli(
  root: string,
  args: readonly string[],
  observe: {
    record?(value: { readonly type?: string }, running: boolean, cancel: () => void): void
    diagnostic?(text: string, running: boolean, cancel: () => void): void
  } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([join(import.meta.dir, '../bin/jig'), ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const cancel = () => child.kill('SIGINT')
  const timeout = setTimeout(cancel, 45_000)
  let buffered = ''
  const stdout = consume(child.stdout, (text) => {
    if (!observe.record) return
    buffered += text
    for (;;) {
      const newline = buffered.indexOf('\n')
      if (newline === -1) return
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(newline + 1)
      observe.record(JSON.parse(line), child.exitCode === null, cancel)
    }
  })
  const stderr = consume(child.stderr, (text) =>
    observe.diagnostic?.(text, child.exitCode === null, cancel),
  )
  try {
    const [code, out, error] = await Promise.all([child.exited, stdout, stderr])
    return { code, stdout: out, stderr: error }
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) cancel()
    await child.exited
    await Promise.allSettled([stdout, stderr])
  }

  async function consume(stream: ReadableStream<Uint8Array>, chunk: (text: string) => void) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
      for (;;) {
        const result = await reader.read()
        if (result.done) return text + decoder.decode()
        const next = decoder.decode(result.value, { stream: true })
        text += next
        if (text.length > 4 * 1024 * 1024)
          throw new Error('channel CLI fixture output exceeded its bound')
        chunk(next)
      }
    } finally {
      reader.releaseLock()
    }
  }
}
async function writeBoundResourceProject(root: string): Promise<void> {
  await writeFile(
    join(root, 'jig.ts'),
    'import { defineJig, discover } from "@jigging/jig"; export default defineJig({flows: discover("flows"), bindings: discover("bindings")});',
  )
  await mkdir(join(root, 'bindings'))
  await mkdir(join(root, 'flows/decode'), { recursive: true })
  await writeFile(
    join(root, 'flows/decode/FLOW.contract.json'),
    JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      attachments: { decoder: 'read' },
      outcomes: { blocked: 'The selected decoder refused its input.' },
    }),
  )
  await writeFile(
    join(root, 'flows/decode/FLOW.ts'),
    `
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.method !== 'flow/run') continue;
  const tool = request.params.attachments.decoder.path + '/decode.ts';
  const original = readFileSync(tool);
  let immutable = false;
  try { writeFileSync(tool, 'overwrite'); } catch { immutable = true; }
  if (!readFileSync(tool).equals(original)) throw new Error('resource changed');
  const child = spawn(process.execPath, ['--no-env-file', '--no-install', '--config=/dev/null', tool, String(request.params.input)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const bytes = [];
  child.stdout.on('data', data => bytes.push(data));
  child.stderr.pipe(process.stderr);
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const result = exitCode === 0 ? { outcome: 'done', output: { bytes: [...Buffer.concat(bytes)], immutable, hostAbsent: !existsSync(${JSON.stringify(root)}) } } : { outcome: 'blocked', output: { exitCode } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
  lines.close(); break;
}
`,
  )
  for (const [id, decode] of [
    ['first', 'Buffer.from(value, "base64")'],
    ['second', 'Uint8Array.from(atob(value), c => c.charCodeAt(0))'],
  ]) {
    await mkdir(join(root, 'tools', id!), { recursive: true })
    await writeFile(
      join(root, 'tools', id!, 'decode.ts'),
      `const value = process.argv[2];
if (value === 'bad') process.exit(2);
if (value === 'hold') { console.error('bound-tool-started'); setInterval(() => {}, 1000); }
else process.stdout.write(${decode});`,
    )
    await writeFile(
      join(root, 'bindings', id! + '.ts'),
      `import { defineBinding } from '@jigging/jig'; export default defineBinding({ package: 'flows/decode', attachments: { decoder: 'tools/${id}' } });`,
    )
  }
}
function bunWorkerProgram(): string {
  return [
    '#!/usr/bin/env bun',
    'import { handle } from "./flow-sdk/index.js";',
    '',
    'await handle(async (context) => {',
    '  const delayMs = typeof context.input === "object" && context.input !== null &&',
    '    "delayMs" in context.input && typeof context.input.delayMs === "number"',
    '    ? context.input.delayMs',
    '    : 0;',
    '  if (delayMs > 0) await Bun.sleep(delayMs);',
    '  return { outcome: "done", output: { worker: context.input } };',
    '});',
    '',
  ].join('\n')
}
async function invoke(arguments_: readonly string[]): Promise<unknown> {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '..', 'scripts', 'private-foreground.ts'),
      ...arguments_,
    ],
    {
      cwd: join(import.meta.dir, '..', '..', '..'),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  if (exitCode !== 0) throw new Error(`private foreground failed (${exitCode}): ${stderr}`)
  expect(stderr).toBe('')
  return JSON.parse(stdout)
}
async function invokeRun(root: string, request: unknown): Promise<ForegroundRunResult> {
  return (await invoke(['run', root, '--request', JSON.stringify(request)])) as ForegroundRunResult
}
function firstRun(result: ForegroundRunResult): ForegroundRunEntry {
  expect(result.kind).toBe('private-foreground-run/0')
  expect(result.runs).toHaveLength(1)
  return result.runs[0]!
}
async function invokeFailure(arguments_: readonly string[]): Promise<string> {
  const subprocess = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '..', 'scripts', 'private-foreground.ts'),
      ...arguments_,
    ],
    {
      cwd: join(import.meta.dir, '..', '..', '..'),
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ])
  expect(exitCode).not.toBe(0)
  expect(stdout).toBe('')
  return stderr
}
function inspectPlanningState(root: string): {
  readonly candidateRevision: number
  readonly candidates: number
  readonly plans: number
  readonly admissions: number
  readonly rootRuns: number
  readonly planDigest: string
} {
  return withStore(root, (database) => {
    const scalar = (query: string, field: string): unknown => database.query(query).get()[field]
    return {
      candidateRevision: Number(
        scalar('SELECT revision FROM candidate_head WHERE singleton = 1', 'revision'),
      ),
      candidates: Number(scalar('SELECT count(*) AS count FROM candidates', 'count')),
      plans: Number(scalar('SELECT count(*) AS count FROM review_plans', 'count')),
      admissions: Number(scalar('SELECT count(*) AS count FROM admissions', 'count')),
      rootRuns: Number(scalar('SELECT count(*) AS count FROM root_runs', 'count')),
      planDigest: String(scalar('SELECT plan_digest FROM review_plans', 'plan_digest')),
    }
  })
}
function inspectRootExecution(
  root: string,
  runId: string,
): {
  readonly rows: number
  readonly sandboxDigest: string
  readonly preparedDigest: string
} {
  return withStore(root, (database) => {
    const row = database
      .query(
        [
          'SELECT count(*) AS rows, max(sandbox_digest) AS sandbox_digest,',
          'max(prepared_digest) AS prepared_digest FROM root_execution_lifecycles WHERE run_id = ?1',
        ].join(' '),
      )
      .get(runId)
    return {
      rows: Number(row.rows),
      sandboxDigest: String(row.sandbox_digest),
      preparedDigest: String(row.prepared_digest),
    }
  })
}
function inspectChildOwnerCount(root: string): number {
  return withStore(root, (database) =>
    Number(database.query('SELECT count(*) AS count FROM root_child_owners').get().count),
  )
}
function inspectRunOwnership(
  root: string,
  runId: string,
): {
  readonly childOwners: number
  readonly terminals: number
} {
  return withStore(root, (database) => ({
    childOwners: Number(
      database
        .query('SELECT count(*) AS count FROM root_child_owners WHERE parent_run_id = ?1')
        .get(runId).count,
    ),
    terminals: Number(
      database.query('SELECT count(*) AS count FROM root_terminals WHERE run_id = ?1').get(runId)
        .count,
    ),
  }))
}
async function expectNoChildResidue(root: string): Promise<void> {
  expect(inspectChildOwnerCount(root)).toBe(0)
  const [materializations, owners] = await Promise.all([
    directoryEntries(join(root, '.jig', 'private-root-materializations')),
    directoryEntries(join(root, '.jig', 'private-root-owners')),
  ])
  expect(materializations.filter((entry) => entry.startsWith('child-'))).toEqual([])
  expect(owners.filter((entry) => /^(c-|a-|x-)/.test(entry))).toEqual([])
}
async function treeContains(root: string, needle: string): Promise<boolean> {
  const encoded = Buffer.from(needle)
  for (const relative of await readdir(root, { recursive: true })) {
    const path = join(root, relative)
    const information = await lstat(path)
    if (information.isFile() && Buffer.from(await readFile(path)).includes(encoded)) return true
  }
  return false
}
async function directoryEntries(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return []
    throw error
  }
}
function withStore<Value>(root: string, use: (database: any) => Value): Value {
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
async function waitForPrepared(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const prepared = withStore(root, (database) =>
        database
          .query(
            [
              'SELECT count(*) AS count FROM root_execution_lifecycles',
              'WHERE run_id = ?1 AND sandbox_digest IS NOT NULL AND prepared_digest IS NOT NULL',
            ].join(' '),
          )
          .get(runId),
      )
      if (Number(prepared.count) === 1) return
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'SQLITE_BUSY') throw error
    }
    await Bun.sleep(50)
  }
  throw new Error('root Run did not reach the prepared ownership boundary')
}
async function waitForChildSandbox(root: string, runId: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const child = withStore(root, (database) =>
        database
          .query(
            [
              'SELECT count(*) AS count FROM root_child_owners',
              'WHERE parent_run_id = ?1 AND sandbox_digest IS NOT NULL',
            ].join(' '),
          )
          .get(runId),
      )
      if (Number(child.count) === 1) return
    } catch (error) {
      if ((error as { readonly code?: unknown }).code !== 'SQLITE_BUSY') throw error
    }
    await Bun.sleep(50)
  }
  throw new Error('child Flow did not reach the durable sandbox ownership boundary')
}
async function waitForTerminalStatus(
  administration: RootAdministration,
  receipt: StartRootRunReceipt,
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await administration.runStatus(receipt)
    if (status.state === 'terminal') return status
    await Bun.sleep(20)
  }
  throw new Error('root Run did not reach a terminal status')
}
async function rootlessCgroups(): Promise<string[]> {
  const delegated = process.env.AGENT_DELEGATED_CGROUP
  if (delegated === undefined) {
    if (HOSTILE) throw new Error('rootless project proof has no delegated cgroup')
    return []
  }
  return (await readdir(delegated)).filter((entry) => entry.startsWith('jig-run-')).sort()
}
async function waitForRootlessCgroups(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = await rootlessCgroups()
    if (sameMembers(current, expected)) return
    await Bun.sleep(20)
  }
  throw new Error('rootless project Runs left cgroup residue')
}
function rootlessTemporaryEntry(entry: string): boolean {
  return (
    entry.startsWith('jig-rootless-control-') ||
    entry.startsWith('jig-rootless-owner-') ||
    entry.startsWith('jig-rootless-devices-')
  )
}
async function waitForRootlessTemporaryState(expected: ReadonlySet<string>): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry)
    if (sameMembers(current, expected)) return
    await Bun.sleep(20)
  }
  throw new Error('rootless project Runs left temporary owner state')
}
function sameMembers(values: readonly string[], expected: ReadonlySet<string>): boolean {
  return (
    values.every((value) => expected.has(value)) &&
    [...expected].every((value) => values.includes(value))
  )
}
async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) throw new Error('project-session fixture ended before its receipt')
      buffered += decoder.decode(next.value, { stream: true })
      const newline = buffered.indexOf('\n')
      if (newline !== -1) return buffered.slice(0, newline)
    }
  } finally {
    reader.releaseLock()
  }
}

export type { ApplicablePlan, DatasetPeer, ForegroundRunEntry, ForegroundRunResult }
export {
  agentRouterProgram,
  bunWorkerProgram,
  childProgram,
  copyFlowSdk,
  directoryEntries,
  expectNoChildResidue,
  firstLine,
  firstRun,
  HOSTILE,
  inspectChildOwnerCount,
  inspectPlanningState,
  inspectRootExecution,
  inspectRunOwnership,
  invalidResultChildProgram,
  invoke,
  invokeChannelCli,
  invokeFailure,
  invokeRun,
  metadata,
  recursiveChildProgram,
  rootlessCgroups,
  rootlessTemporaryEntry,
  routerProgram,
  sameMembers,
  throwingChildProgram,
  ticketSchema,
  treeContains,
  waitForChildSandbox,
  waitForPrepared,
  waitForRootlessCgroups,
  waitForRootlessTemporaryState,
  waitForTerminalStatus,
  withStore,
  writeAgentFreeProject,
  writeAgentRouterProject,
  writeBoundResourceProject,
  writeBroadcastChannelProject,
  writeChannelConversationProject,
  writeChannelProject,
  writeChildChannelProject,
  writeProject,
}

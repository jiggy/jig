import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MACOS_FIXTURE_RUN_MS,
  MACOS_FIXTURE_SETTLEMENT_MS,
} from '../fixtures/agent-fixture-host.js'
import { block, createMarkdownFixtures, done } from '../markdown-worker.fixture.js'

const compositionRunMs = process.platform === 'darwin' ? MACOS_FIXTURE_RUN_MS : 45_000
const compositionCommandMs = process.platform === 'darwin' ? MACOS_FIXTURE_SETTLEMENT_MS : 60_000

const markdownFixtures = createMarkdownFixtures()
const { command, prepareCandidateSdkWorkspace, selectArchive, writeTypeScriptEcho } =
  markdownFixtures

beforeAll(async () => {
  markdownFixtures.temporary = await mkdtemp(join(tmpdir(), 'jig-markdown-worker-test-'))
})
afterAll(async () => {
  if (markdownFixtures.temporary === undefined) return
  if (markdownFixtures.preserveFailureEvidence) {
    console.error(`Installed Markdown failure evidence retained at ${markdownFixtures.temporary}`)
  } else {
    await rm(markdownFixtures.temporary, { recursive: true, force: true })
  }
})
describe.serial('fresh installed Markdown admission on the provisioned proof host', () => {
  test('requires an Agent for every Markdown body while code execution remains Agent-free', async () => {
    const root = await mkdtemp(join(markdownFixtures.temporary, 'installed-'))
    const artifacts = join(root, 'artifacts')
    const sdkArtifacts = join(root, 'sdk-artifacts')
    const consumer = join(root, 'consumer')
    await mkdir(artifacts)
    await mkdir(sdkArtifacts)
    await mkdir(consumer)
    const archive = await selectArchive(artifacts)
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { '@jigging/jig': `file:${archive}` },
      }),
    )
    await command(
      [
        process.execPath,
        'install',
        '--ignore-scripts',
        '--no-progress',
        '--backend',
        'copyfile',
        '--network-concurrency',
        '1',
      ],
      consumer,
    )
    const jig = join(consumer, 'node_modules/.bin/jig')
    const project = join(consumer, 'project')
    await command([jig, 'init', '--bare', project], consumer)
    const resultSchema = {
      type: 'object',
      properties: { outcome: { const: 'done' }, output: {} },
      required: ['outcome', 'output'],
      additionalProperties: false,
    }
    const descriptor = JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      id: 'https://example.org/markdown-echo',
      version: '1.0.0',
      input: resultSchema,
      result: resultSchema,
    })
    for (const name of ['recipes', 'prose']) await mkdir(join(project, 'flows', name))
    await writeFile(join(project, 'flows/recipes/FLOW.md'), block('return @input'))
    await writeFile(
      join(project, 'flows/prose/FLOW.md'),
      'Return the input unchanged.\n' + block('return @input'),
    )
    await writeTypeScriptEcho(join(project, 'flows/code-echo'), descriptor)
    await prepareCandidateSdkWorkspace(
      project,
      await selectArchive(sdkArtifacts, undefined, 'flow-sdk'),
    )
    for (const name of ['recipes', 'prose', 'code-echo']) {
      const markdown = name !== 'code-echo'
      if (markdown)
        await writeFile(
          join(project, 'bindings/selected.ts'),
          `import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/${name}"});`,
        )
      await writeFile(
        join(project, 'jig.ts'),
        `import { defineJig } from "@jigging/jig"; export default defineJig({ flows: ["flows/${name}"], bindings: ${markdown ? '["bindings/selected.ts"]' : '[]'} });\n`,
      )
      await command(
        [jig, 'review', '--yes'],
        project,
        markdown ? 1 : 0,
        `review ${name}`,
        markdown ? 'PROJECT_BINDING_INTERFACE_UNRESOLVED' : undefined,
      )
    }
    const output = { exact: ['😺', null], text: 'x'.repeat(102_400) }
    const result = JSON.parse(
      await command(
        [jig, 'run', 'flow:flows/code-echo', '--input', JSON.stringify(done(output))],
        project,
        0,
        'Agent-free code Flow',
      ),
    )
    expect(result).toMatchObject({ status: 'succeeded', outcome: 'done', output })
  }, 120_000)

  test(
    'interprets admitted call/return recipes and forwards a real SDK channel message',
    async () => {
      const root = await mkdtemp(join(markdownFixtures.temporary, 'composition-'))
      const consumer = join(root, 'consumer')
      const artifacts = join(root, 'artifacts')
      const sdkArtifacts = join(root, 'sdk-artifacts')
      for (const path of [consumer, artifacts, sdkArtifacts]) await mkdir(path)
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: { '@jigging/jig': `file:${await selectArchive(artifacts)}` },
        }),
      )
      await command(
        [
          process.execPath,
          'install',
          '--ignore-scripts',
          '--no-progress',
          '--backend',
          'copyfile',
          '--network-concurrency',
          '1',
        ],
        consumer,
      )
      const jig = join(consumer, 'node_modules/.bin/jig')
      const project = join(consumer, 'project')
      await command([jig, 'init', '--bare', project], consumer)
      // Each implementation is an ordinary captured Flow using the packed SDK.
      // The Agent-contract task is deterministic sequential recipe selection, not
      // a native client, model, protocol responder or enforcement substitute.
      await writeTypeScriptEcho(
        join(project, 'flows/code-echo'),
        JSON.stringify({
          $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        }),
      )
      for (const name of ['select', 'sum', 'coordinator']) {
        await mkdir(join(project, 'flows', name))
        await writeFile(
          join(project, 'flows', name, 'package.json'),
          JSON.stringify({ name, private: true, dependencies: { '@jigging/flow': 'workspace:*' } }),
        )
      }
      await cp(
        join(import.meta.dir, '../../../../docs/jig/spec/contracts/agent-run/contract.json'),
        join(project, 'flows/select/FLOW.contract.json'),
      )
      // The contract's channel references are relative to its root.
      await cp(
        join(import.meta.dir, '../../../../docs/jig/spec/contracts/agent-run/contracts'),
        join(project, 'flows/select/contracts'),
        { recursive: true },
      )
      await writeFile(
        join(project, 'flows/select/FLOW.ts'),
        `import {handle} from '@jigging/flow';
await handle(run => {
  const instructions = run.input.instructions;
  const packet = JSON.parse(instructions.slice(instructions.indexOf('\\n\\n{') + 2));
  const settled = packet.settledRuntimeObservations.filter(item => ['receive','send','call'].includes(item.kind));
  const recipe = settled.length + 1;
  if (recipe > packet.recipes.length) throw Error('No remaining authored recipe');
  if (packet.recipes[recipe - 1].diagnostic) throw Error('Authored recipe is unavailable');
  console.error(JSON.stringify({stage:'markdown-composition-decision',atUnixMs:Date.now(),recipe,settledCount:settled.length,recipeCount:packet.recipes.length}));
  return {outcome:'done',output:{text:'',structured:{action:'recipe',recipe,operand:'none',value:'',path:''}}};
});\n`,
      )
      await writeFile(
        join(project, 'flows/sum/FLOW.ts'),
        `import {handle} from '@jigging/flow';
await handle(run => {
  console.error(JSON.stringify({stage:'markdown-composition-sum',atUnixMs:Date.now(),valueCount:run.input.values.length}));
  return {outcome:'done',output:{sum:run.input.values.reduce((a,b)=>a+b,0),exact:run.input}};
});\n`,
      )
      await mkdir(join(project, 'flows/procedure'))
      await writeFile(
        join(project, 'flows/procedure/FLOW.md'),
        '---\nuses: {sum: {}}\n---\n' +
          block('receive updates') +
          block('send published @previous') +
          block('call sum @input') +
          block('return @previous'),
      )
      await writeFile(
        join(project, 'flows/procedure/FLOW.contract.json'),
        JSON.stringify({
          $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
          channels: { updates: { direction: 'receive' }, published: { direction: 'send' } },
        }),
      )
      await writeFile(
        join(project, 'flows/coordinator/FLOW.meta.json'),
        JSON.stringify({ uses: { procedure: {} } }),
      )
      await writeFile(
        join(project, 'flows/coordinator/FLOW.ts'),
        `import {handle} from '@jigging/flow';
await handle(async run => {
  const mark = stage => console.error(JSON.stringify({stage,atUnixMs:Date.now()}));
  mark('markdown-composition-coordinator-enter');
  const updates = await run.channel({schema:{}});
  const published = await run.channel({schema:{}});
  mark('markdown-composition-channels-open');
  const work = run.call({operationId:'procedure',slot:'procedure',input:run.input,channels:{updates:updates.receive,published:published.send}});
  const settled = work.then(result=>{mark('markdown-composition-child-returned');return {result}},error=>{mark('markdown-composition-child-rejected');return {error}});
  try {
    await updates.send.send(null);
    mark('markdown-composition-update-sent');
    await updates.send.close();
    mark('markdown-composition-updates-closed');
    const message = await published.receive.next();
    mark('markdown-composition-published-received');
    const completion = await settled;
    if ('error' in completion) throw completion.error;
    return {outcome:'done',output:{result:completion.result,message}};
  } finally {
    await published.receive.close();
    mark('markdown-composition-published-closed');
    await settled;
  }
});\n`,
      )
      await writeFile(
        join(project, 'bindings/procedure.ts'),
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/procedure',slots:{'markdown-agent':'flow:flows/select',sum:'flow:flows/sum'}});\n`,
      )
      await writeFile(
        join(project, 'bindings/coordinator.ts'),
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/coordinator',slots:{procedure:'binding:procedure'}});\n`,
      )
      await writeFile(
        join(project, 'jig.ts'),
        `import {defineJig} from '@jigging/jig'; export default defineJig({flows:['flows/select','flows/sum','flows/procedure','flows/coordinator'],bindings:['bindings/procedure.ts','bindings/coordinator.ts']});\n`,
      )
      await prepareCandidateSdkWorkspace(
        project,
        await selectArchive(sdkArtifacts, undefined, 'flow-sdk'),
      )
      await command([jig, 'review', '--yes'], project)
      const input = { values: [2, 3, 4], exact: ['😺', null], literal: '@previous' }
      // Budget all four native decision turns and the code child before submission.
      // Progress never renews this deadline or the command and case timeouts.
      const result = JSON.parse(
        await command(
          [
            jig,
            'run',
            'binding:coordinator',
            '--timeout',
            `${compositionRunMs}ms`,
            '--input',
            JSON.stringify(input),
          ],
          project,
          0,
          'installed Markdown channel composition',
          undefined,
          compositionCommandMs,
        ),
      )
      expect(result).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        output: {
          result: done({ sum: 9, exact: input }),
          message: { done: false, value: { done: false, value: null } },
        },
      })
    },
    compositionCommandMs + 60_000,
  )
})

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires opted-in native host qualification')

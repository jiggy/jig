import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dir, '..')
const temporary = await mkdtemp(join(tmpdir(), 'jig-package-'))
let completed = false
const expectedInstalledFiles = [
  'LICENSE.md',
  'PRICING.md',
  'LICENSES.md',
  'LICENSES/Apache-2.0.txt',
  'LICENSES/CC-BY-4.0.txt',
  'LICENSES/Community-Spec-1.0.md',
  'LICENSES/MPL-2.0.txt',
  'README.md',
  'THIRD_PARTY_NOTICES',
  'bin/jig',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/json.d.ts',
  'dist/project/author.d.ts',
  'dist/project/commands.d.ts',
  'dist/project/grants.d.ts',
  'dist/schema/types.d.ts',
  'libexec/installed-cli.js',
  'libexec/authoring/contract-authoring-worker.js',
  'libexec/markdown-runtime.js',
  'libexec/http-request-worker.js',
  'libexec/flow.LICENSE',
  'libexec/agent/codex-acp.LICENSE',
  'libexec/agent/codex-acp.js',
  'libexec/agent/codex-agent-launcher.js',
  'libexec/agent/codex-requirements.toml',
  'libexec/agent/claude-agent-acp.LICENSE',
  'libexec/agent/claude-agent-acp.js',
  'libexec/agent/claude-agent-launcher.js',
  'libexec/agent/claude-agent-sdk.LICENSE',
  'libexec/agent/pi-acp.LICENSE',
  'libexec/agent/pi-acp.js',
  'libexec/agent/pi-agent-launcher.js',
  'libexec/evaluator/project-authoring-1.schema.json',
  'libexec/evaluator/project-evaluator-sdk.bundle.js',
  'libexec/evaluator/project-evaluator-worker.js',
  'libexec/preparation/bun-native-preparation-worker.js',
  'libexec/linux-rootless-supervisor.js',
  'package.json',
].sort()

try {
  const artifacts = join(temporary, 'artifacts')
  const consumer = join(temporary, 'consumer')
  await mkdir(artifacts)
  await mkdir(consumer)
  const archive = await selectArchive(artifacts)

  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@jigging/jig': `file:${archive}` },
    }),
  )
  await run(
    [
      'bun',
      'install',
      '--ignore-scripts',
      '--no-progress',
      '--cache-dir',
      join(temporary, 'cache'),
      '--backend',
      'copyfile',
    ],
    consumer,
  )
  const installed = join(consumer, 'node_modules', '@jigging', 'jig')
  const installedFiles = await listFiles(installed)
  const installedManifest = JSON.parse(
    await readFile(join(installed, 'package.json'), 'utf8'),
  ) as Record<string, unknown>
  assert.deepEqual(installedFiles, expectedInstalledFiles)
  await stat(
    join(installed, 'libexec/authoring/node_modules/@jigging/flow-authoring/dist/index.js'),
  )
  assert.deepEqual(installedManifest.bin, { jig: './bin/jig' })
  await assert.rejects(stat(join(installed, 'libexec/authoring/node_modules/.package-lock.json')), {
    code: 'ENOENT',
  })
  await assert.rejects(stat(join(installed, 'libexec/authoring/node_modules/.bin')), {
    code: 'ENOENT',
  })
  assert.deepEqual(installedManifest.dependencies, {
    '@oven/bun-linux-x64-baseline': '1.3.3',
  })
  assert.equal(Object.hasOwn(installedManifest, 'private'), false)
  const sourceManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(installedManifest.version, sourceManifest.version)
  assert.equal(installedManifest.license, 'SEE LICENSE IN LICENSE.md')
  for (const relative of [
    'LICENSE.md',
    'PRICING.md',
    'LICENSES.md',
    'LICENSES/Apache-2.0.txt',
    'LICENSES/CC-BY-4.0.txt',
    'LICENSES/Community-Spec-1.0.md',
    'LICENSES/MPL-2.0.txt',
  ]) {
    assert.equal(
      await readFile(join(installed, relative), 'utf8'),
      await readFile(resolve(packageRoot, '../..', relative), 'utf8'),
      relative,
    )
  }
  // Published Bread 1.0, revision 2160335: the adoption notice may change,
  // but the retained standard must stay exact without fetching it at build time.
  const retainedLicense = await readFile(join(installed, 'LICENSE.md'), 'utf8')
  const standardStart = retainedLicense.indexOf('\n# Bread License 1.0\n')
  assert.notEqual(standardStart, -1, 'Missing retained Bread License 1.0')
  assert.equal(
    createHash('sha256')
      .update(retainedLicense.slice(standardStart + 1))
      .digest('hex'),
    '80e9d09705bea0b964abdc5449f0384ad7758dc17ba05f2a0bb2998ea5ab2be9',
    'The retained Bread 1.0 text differs from the published standard',
  )
  const thirdPartyNotices = await readFile(join(installed, 'THIRD_PARTY_NOTICES'), 'utf8')
  assert.equal(thirdPartyNotices, await readFile(join(packageRoot, 'THIRD_PARTY_NOTICES'), 'utf8'))
  assert.ok(
    thirdPartyNotices.includes(
      await readFile(join(packageRoot, 'node_modules/zod/LICENSE'), 'utf8'),
    ),
    'Missing bundled Zod license notice',
  )
  for (const [retained, original] of [
    ['codex-acp.LICENSE', '@agentclientprotocol/codex-acp/LICENSE'],
    ['claude-agent-acp.LICENSE', '@agentclientprotocol/claude-agent-acp/LICENSE'],
    ['claude-agent-sdk.LICENSE', '@anthropic-ai/claude-agent-sdk/LICENSE.md'],
    ['pi-acp.LICENSE', 'pi-acp/LICENSE'],
  ]) {
    assert.equal(
      await readFile(join(installed, 'libexec/agent', retained), 'utf8'),
      await readFile(join(packageRoot, 'node_modules', original), 'utf8'),
      retained,
    )
  }
  assert.deepEqual(installedManifest.os, ['linux'])
  assert.deepEqual(installedManifest.cpu, ['x64'])
  assert.deepEqual(installedManifest.libc, ['glibc'])
  assert.equal(Object.hasOwn(installedManifest, 'scripts'), false)

  const executable = join(installed, 'bin', 'jig')
  const piLauncher = join(installed, 'libexec', 'agent', 'pi-agent-launcher.js')
  const command = join(consumer, 'node_modules', '.bin', 'jig')
  assert.notEqual((await stat(executable)).mode & 0o111, 0)
  assert.notEqual((await stat(piLauncher)).mode & 0o111, 0)
  const launcher = await readFile(executable, 'utf8')
  assert.match(launcher, /^#!\/bin\/sh\n/)
  assert.match(launcher, /\/usr\/bin\/readlink/)
  assert.match(launcher, /\/bin\/readlink/)
  assert.match(launcher, /\/run\/current-system\/sw\/bin\/readlink/)
  assert.doesNotMatch(launcher, /command -v|\bPATH\b/)

  // Project-controlled Bun configuration must not execute before Jig can
  // enter its containment boundary. Exercise the installed executable in Bun
  // mode so both dotenv loading and bunfig preloads are directly observable.
  const ambientMarker = join(consumer, 'ambient-marker')
  await writeFile(join(consumer, '.env'), 'JIG_AMBIENT_POISON=loaded\n')
  await writeFile(join(consumer, 'bunfig.toml'), 'preload = ["./ambient-preload.mjs"]\n')
  await writeFile(
    join(consumer, 'ambient-preload.mjs'),
    `await Bun.write(${JSON.stringify(ambientMarker)}, "executed");\n`,
  )
  const help = await run([command, '--help'], consumer)
  const version = await run([command, '--version'], consumer)
  assert.equal(version.stdout, `${sourceManifest.version}\n`)
  assert.equal(version.stderr, '')
  const manifestPath = join(installed, 'package.json')
  const manifestBytes = await readFile(manifestPath)
  try {
    await writeFile(manifestPath, JSON.stringify({ ...installedManifest, version: '0.0.0' }))
    const retainedVersion = await run([command, '--version'], consumer)
    assert.equal(retainedVersion.stdout, `${sourceManifest.version}\n`)
    assert.equal(retainedVersion.stderr, '')
  } finally {
    await writeFile(manifestPath, manifestBytes)
  }
  assert.equal(help.stderr, '')
  assert.match(help.stdout, /^ {2}jig init <directory> +Create/m)
  assert.match(help.stdout, /^ {2}jig review \[project\] +Review/m)
  assert.match(help.stdout, /^ {2}jig --version +Print/m)
  assert.match(help.stdout, /^ {2}jig run \[target\] +Choose or run/m)
  assert.doesNotMatch(help.stdout, /setup|package check|planDigest/)
  const runHelp = await run([command, 'run', '--help'], consumer)
  assert.equal(runHelp.stderr, '')
  assert.match(runHelp.stdout, /^Usage: jig run \[flow:path\|npm:package\|binding:id\] \[options\]/)
  assert.match(runHelp.stdout, /--input JSON\|@FILE/)
  assert.match(runHelp.stdout, /--receive CHANNEL/)
  assert.match(runHelp.stdout, /Ctrl-C cancels/)
  assert.doesNotMatch(runHelp.stdout, /jig init|--allow-resolution-network/)
  const reviewHelp = await run([command, 'review', '--help'], consumer)
  assert.match(reviewHelp.stdout, /--details/)
  assert.match(reviewHelp.stdout, /--generate-contracts/)
  assert.match(reviewHelp.stdout, /--yes alone does not approve new resource authority/)
  const greeting = join(consumer, 'greeting')
  const initializedGreeting = await run([command, 'init', greeting], consumer)
  assert.match(initializedGreeting.stdout, /jig review --allow-resolution-network/)
  assert.match(await readFile(join(greeting, 'flows/hello/FLOW.ts'), 'utf8'), /@jigging\/flow/)
  await assert.rejects(stat(join(greeting, '.jig')), { code: 'ENOENT' })
  await assert.rejects(stat(join(greeting, 'flows/hello/node_modules')), { code: 'ENOENT' })
  const added = await run([command, 'new', 'summarize'], greeting)
  assert.match(added.stdout, /Created Flow "flows\/summarize"/)
  assert.match(added.stdout, /Edit flows\/summarize\/FLOW\.ts/)
  assert.doesNotMatch(added.stdout, /FLOW\.md/)
  assert.match(await readFile(join(greeting, 'flows/summarize/FLOW.ts'), 'utf8'), /@jigging\/flow/)
  await assert.rejects(stat(join(greeting, '.jig')), { code: 'ENOENT' })
  const completion = await run([command, 'completion', 'bash'], greeting)
  assert.match(completion.stdout, /jig completion targets/)
  const targets = await run([command, 'completion', 'targets'], greeting)
  assert.equal(targets.stdout, '')
  assert.equal(targets.stderr, '')
  await assert.rejects(stat(ambientMarker), { code: 'ENOENT' })

  // Ordinary installed authoring must work without acquiring the execution host
  // and must not evaluate the source package or the consumer's ambient config.
  const contractSource = join(consumer, 'contract-source')
  await mkdir(join(contractSource, 'agreements'), { recursive: true })
  const borrowed = JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/channel-contract-0.schema.json',
    id: 'https://example.org/import-progress',
    version: '1.0.0',
    semantics: 'Progress is not success.',
    item: true,
  })
  const contract = JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
    channels: { progress: { direction: 'send', contract: './agreements/progress.json' } },
  })
  await writeFile(join(contractSource, 'FLOW.contract.json'), contract)
  await writeFile(join(contractSource, 'agreements/progress.json'), borrowed)
  await writeFile(join(contractSource, 'FLOW.ts'), 'throw new Error("must not execute")')
  const imported = await run(
    [command, 'import-contract', 'contract-source/FLOW.contract.json', 'imported-contract'],
    consumer,
  )
  assert.match(imported.stdout, /Imported 2 contract files/)
  assert.equal(
    await readFile(join(consumer, 'imported-contract/FLOW.contract.json'), 'utf8'),
    contract,
  )
  assert.equal(
    await readFile(join(consumer, 'imported-contract/agreements/progress.json'), 'utf8'),
    borrowed,
  )
  await assert.rejects(stat(join(consumer, 'imported-contract/FLOW.ts')), { code: 'ENOENT' })
  await assert.rejects(stat(ambientMarker), { code: 'ENOENT' })

  await Promise.all([
    rm(join(consumer, '.env')),
    rm(join(consumer, 'bunfig.toml')),
    rm(join(consumer, 'ambient-preload.mjs')),
  ])

  // Exercise the installed compiler closure, not workspace imports. This catches
  // archive omissions even when another package manager would fetch missing deps.
  const compiler = Bun.spawn(
    [
      process.env.JIG_AUTHORING_NODE_PATH ?? process.env.FLOW_NODE ?? 'node',
      join(installed, 'libexec/authoring/contract-authoring-worker.js'),
    ],
    { cwd: consumer, env: {}, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  )
  const compilerTimeout = setTimeout(() => compiler.kill('SIGKILL'), 25000)
  try {
    compiler.stdin.write(
      JSON.stringify({
        source: `
import "@jigging/flow-authoring/typespec";
using FLOW;
@invocation(Input, Result) namespace Smoke;
@closed model Input { name: string; }
@closed model Result { outcome: "done"; output: string; }
`,
      }) + '\n',
    )
    await compiler.stdin.flush()
    const [code, output, diagnostic] = await Promise.all([
      compiler.exited,
      new Response(compiler.stdout).text(),
      new Response(compiler.stderr).text(),
    ])
    assert.equal(code, 0, diagnostic)
    const generated = JSON.parse(output)
    assert.equal(JSON.parse(generated.artifacts['FLOW.contract.json']).$defs.Input.type, 'object')
    assert.match(generated.artifacts['FLOW.contract.d.ts'], /FlowInput/)
  } finally {
    clearTimeout(compilerTimeout)
    compiler.kill('SIGKILL')
    await compiler.exited
  }

  const runtime = join(consumer, 'node_modules', '@oven', 'bun-linux-x64-baseline', 'bin', 'bun')
  const runtimeBytes = await readFile(runtime)
  assert.equal(
    createHash('sha256').update(runtimeBytes).digest('hex'),
    'e666c943af70078a72bad00757a094776a54621fecd83eb4aa982760f9186839',
  )
  const bun = await run([runtime, '--version'], consumer)
  assert.equal(bun.stdout, '1.3.3\n')
  assert.equal(bun.stderr, '')
  const revision = await run([runtime, '--revision'], consumer)
  assert.equal(revision.stdout, '1.3.3+274e01c73\n')
  assert.match(
    await readFile(join(installed, 'THIRD_PARTY_NOTICES'), 'utf8'),
    /EXTERNAL RUNTIME DEPENDENCY — NOT INCLUDED/,
  )

  // A direct, invalid launch must explain recovery without printing a private stack.
  const invalidLaunch = Bun.spawn(
    [runtime, join(installed, 'libexec/installed-cli.js'), '--help'],
    {
      cwd: consumer,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const invalidLaunchOutput = await new Response(invalidLaunch.stdout).text()
  const invalidLaunchError = await new Response(invalidLaunch.stderr).text()
  assert.equal(await invalidLaunch.exited, 2)
  assert.equal(invalidLaunchOutput, '')
  assert.match(invalidLaunchError, /^Error: Command could not finish/)
  assert.match(invalidLaunchError, /Invoke the installed jig command directly/)
  assert.match(invalidLaunchError, /Diagnostic code: JIG_COMMAND_UNAVAILABLE/)
  assert.doesNotMatch(invalidLaunchError, /libexec|at runPrivate/)
  assert.equal(invalidLaunchError.includes('\u001b'), false)

  const bareProject = join(consumer, 'bare-project')
  const initialized = await run([command, 'init', '--bare', bareProject], consumer)
  assert.equal(
    initialized.stdout,
    `Created bare Jig project ${JSON.stringify(bareProject)}.\n\nNext:\n  Add a Flow under flows/ and select it in jig.ts, then run jig review.\n`,
  )
  assert.equal(initialized.stderr, '')
  assert.deepEqual((await readdir(bareProject)).sort(), [
    '.gitignore',
    'bindings',
    'flows',
    'jig.ts',
  ])
  assert.deepEqual(await readdir(join(bareProject, 'bindings')), [])
  assert.deepEqual(await readdir(join(bareProject, 'flows')), [])

  for (const relative of [
    'libexec/linux-rootless-supervisor.js',
    'libexec/markdown-runtime.js',
    'libexec/evaluator/project-evaluator-worker.js',
    'libexec/evaluator/project-evaluator-sdk.bundle.js',
    'libexec/agent/codex-agent-launcher.js',
    'libexec/agent/claude-agent-acp.js',
    'libexec/agent/claude-agent-launcher.js',
    'libexec/agent/pi-acp.js',
    'libexec/agent/pi-agent-launcher.js',
    'libexec/preparation/bun-native-preparation-worker.js',
  ]) {
    const source = await readFile(join(installed, relative), 'utf8')
    assert.doesNotMatch(source, /(?:from|import\()\s*["']\.\.?\//)
  }

  await writeFile(
    join(consumer, 'smoke.mjs'),
    `
import { defineBinding, defineJig, discover } from "@jigging/jig";
const project = defineJig({ flows: discover("./flows"), grants: discover("./grants") });
const binding = defineBinding({
  package: "./flows/review",
  settings: { profile: "fast" },
  slots: { worker: "flow:./flows/worker", cli: { kind: "command", run: "src/cli.ts" }, reference: "grant:documents" },
});
if (project.flows.roots[0] !== "flows" || binding.package !== "flows/review" ||
    binding.settings.profile !== "fast" || binding.slots.worker !== "flow:flows/worker" ||
    binding.slots.cli.run !== "src/cli.ts") {
  throw new Error("bad package exports");
}
`,
  )
  await run(['bun', 'smoke.mjs'], consumer)

  await writeFile(
    join(consumer, 'smoke.ts'),
    `
import { defineBinding, defineJig, discover, type JigDefinitionInput, type PackageBindingInput } from "@jigging/jig";
const input: JigDefinitionInput = { flows: discover("./flows") };
const project = defineJig(input);
const bindingInput: PackageBindingInput = {
  package: "./flows/router",
  settings: { profile: "fast" },
  slots: { worker: "flow:./flows/worker", tests: { kind: "command", test: ["test/project.test.ts"] }, reference: { kind: "http", url: "https://example.org/", method: "POST", bodySchema: { type: "object", additionalProperties: false } } },
};
const binding = defineBinding(bindingInput);
void project;
void binding;
`,
  )
  await writeFile(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
      },
      files: ['smoke.ts'],
    }),
  )
  await run(
    [
      process.execPath,
      join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(consumer, 'tsconfig.json'),
    ],
    packageRoot,
  )
  if (process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') {
    const project = join(consumer, 'granted-command')
    for (const path of ['flows/check', 'bindings', 'grants', 'libs/flow'])
      await mkdir(join(project, path), { recursive: true })
    // Qualify both candidate archives before publication. The complete SDK is an
    // ordinary local workspace member, never an injected private runtime helper.
    const sdkArtifacts = join(temporary, 'sdk-artifacts')
    await mkdir(sdkArtifacts)
    const sdkArchive = await selectArchive(sdkArtifacts, 'flow-sdk')
    await run(
      ['tar', '-xzf', sdkArchive, '--strip-components=1', '-C', join(project, 'libs/flow')],
      consumer,
    )
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['flows/*', 'libs/*'] }),
    )
    await writeFile(
      join(project, 'jig.ts'),
      'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings"),grants:discover("grants")});',
    )
    await writeFile(
      join(project, 'flows/check/package.json'),
      JSON.stringify({
        name: 'grant-consumer',
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'workspace:*' },
      }),
    )
    await writeFile(
      join(project, 'flows/check/FLOW.meta.json'),
      JSON.stringify({ uses: { check: { contract: './command.json' } } }),
    )
    await writeFile(
      join(project, 'flows/check/command.json'),
      await readFile(
        join(packageRoot, '../../docs/jig/spec/contracts/project-command/contract.json'),
      ),
    )
    await writeFile(
      join(project, 'flows/check/FLOW.ts'),
      'import {handle} from "@jigging/flow"; await handle(run=>run.call({operationId:"check",slot:"check",input:run.input}));',
    )
    await writeFile(
      join(project, 'grants/check.json'),
      JSON.stringify({ kind: 'command', run: 'index.ts' }),
    )
    for (const [name, policy] of [
      ['inline', { kind: 'command', run: 'index.ts' }],
      ['named', 'grant:check'],
    ]) {
      await writeFile(
        join(project, 'bindings', name + '.ts'),
        'import {defineBinding} from "@jigging/jig"; export default defineBinding(' +
          JSON.stringify({ package: 'flows/check', slots: { check: policy } }) +
          ');',
      )
    }
    await assert.rejects(
      run([command, 'review', '--yes', '--allow-resolution-network'], project, {}, 120000),
      /JIG_AUTHORITY_APPROVAL_REQUIRED/,
    )
    await run(
      [command, 'review', '--yes', '--allow-authority-changes', '--allow-resolution-network'],
      project,
      {},
      120000,
    )
    for (const target of ['binding:inline', 'binding:named']) {
      const observed = await run(
        [
          command,
          'run',
          target,
          '--input',
          JSON.stringify({ files: { 'index.ts': 'console.log("checked");' } }),
        ],
        project,
        {},
        120000,
      )
      const result = JSON.parse(observed.stdout)
      assert.equal(result.status, 'succeeded')
      assert.equal(result.output.exitCode, 0)
      assert.equal(result.output.stdout.text, 'checked\n')
      assert.equal(result.output.cleanup, 'complete')
      assert.deepEqual(result.output.invocation, ['bun', 'index.ts'])
    }
    const unsuccessful = await run(
      [
        command,
        'run',
        'binding:named',
        '--input',
        JSON.stringify({
          files: { 'index.ts': 'console.error("failed check"); process.exit(17);' },
        }),
      ],
      project,
      {},
      120000,
    )
    const failure = JSON.parse(unsuccessful.stdout)
    assert.equal(failure.output.exitCode, 17)
    assert.equal(failure.output.stderr.text, 'failed check\n')
    assert.equal(failure.output.cleanup, 'complete')

    // Consume the complete ordinary Agent through installed public commands,
    // with no rewritten workers or private host imports in the application.
    const agentProject = join(consumer, 'http-agent')
    for (const path of ['flows/agent', 'bindings'])
      await mkdir(join(agentProject, path), { recursive: true })
    const methodArtifacts = join(temporary, 'method-artifacts')
    await mkdir(methodArtifacts)
    const methodArchive = await selectArchive(methodArtifacts, 'agent-method')
    await run(
      [
        'tar',
        '-xzf',
        methodArchive,
        '--strip-components=1',
        '-C',
        join(agentProject, 'flows/agent'),
      ],
      consumer,
    )
    let mode: 'answer' | 'malformed' | 'markdown' | 'markdown-malformed' = 'answer'
    let requests = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        requests++
        assert.equal(request.headers.get('authorization'), 'Bearer local-method-test-token')
        const body = (await request.json()) as any
        const responses = new URL(request.url).pathname === '/v1/responses'
        assert.equal(body.model, 'recorded-model')
        assert.equal(responses ? body.max_output_tokens : body.max_completion_tokens, 32)
        assert.equal(body.stream, false)
        assert.equal(body.store, false)
        assert.equal(body.n, responses ? undefined : 1)
        assert.equal(body.tools, undefined)
        assert.match(
          responses ? body.input : body.messages[0].content,
          mode.startsWith('markdown') ? /Return the word READY/ : /Classify this request/,
        )
        const format = responses ? body.text.format : body.response_format.json_schema
        assert.equal(format.strict, true)
        assert.equal(format.name, 'flow_agent_result')
        assert.doesNotMatch(JSON.stringify(body), /local-method-test-token/)
        if (responses)
          return Response.json({
            object: 'response',
            status: 'completed',
            output: [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [
                  {
                    type: 'output_text',
                    text: mode === 'answer' ? '{"category":"support"}' : '{"category":42}',
                  },
                ],
              },
            ],
          })
        return Response.json({
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: mode.startsWith('markdown')
                  ? JSON.stringify({
                      action: 'finish',
                      recipe: mode === 'markdown-malformed' ? 99 : 0,
                      operand: 'literal',
                      value: JSON.stringify({ outcome: 'done', output: 'READY' }),
                      path: '',
                    })
                  : mode === 'answer'
                    ? '{"category":"support"}'
                    : '{"category":42}',
              },
            },
          ],
        })
      },
    })
    try {
      await writeFile(
        join(agentProject, 'jig.ts'),
        'import {defineJig,discover} from "@jigging/jig"; export default defineJig({flows:discover("flows"),bindings:discover("bindings"),defaultProviders: { "https://jig.md/contracts/agent-run": "binding:agent" }});',
      )
      await writeFile(
        join(agentProject, 'bindings/agent.ts'),
        'import {defineBinding} from "@jigging/jig"; export default defineBinding(' +
          JSON.stringify({
            package: 'flows/agent',
            settings: {
              model: 'recorded-model',
              maxCompletionTokens: 32,
              structuredOutput: 'json-schema',
            },
            slots: {
              http: {
                kind: 'http',
                method: 'POST',
                url: `http://127.0.0.1:${server.port}/v1/chat/completions`,
                bearerEnv: 'METHOD_TEST_TOKEN',
              },
            },
          }) +
          ');',
      )
      const environment: NodeJS.ProcessEnv = {
        ...Object.fromEntries(
          Object.keys(process.env)
            .filter((name) => /^(OPENAI_|OPENROUTER_|CODEX_|CLAUDE_|PI_)/.test(name))
            .map((name) => [name, undefined]),
        ),
        METHOD_TEST_TOKEN: 'local-method-test-token',
      }
      await run(
        [command, 'review', '--yes', '--allow-authority-changes', '--allow-resolution-network'],
        agentProject,
        environment,
        120000,
      )
      const input = JSON.stringify({
        instructions: 'Classify this request: I need help.',
        responseSchema: {
          $schema: 'https://flow.jig.md/schemas/schema-0.json',
          type: 'object',
          properties: { category: { type: 'string', enum: ['support'] } },
          required: ['category'],
          additionalProperties: false,
        },
      })
      const completed = await run(
        [command, 'run', 'binding:agent', '--input', input],
        agentProject,
        environment,
        120000,
      )
      const answer = JSON.parse(completed.stdout)
      assert.equal(answer.status, 'succeeded')
      assert.equal(answer.outcome, 'done')
      assert.deepEqual(answer.output.structured, { category: 'support' })
      assert.doesNotMatch(completed.stdout + completed.stderr, /local-method-test-token/)
      mode = 'malformed'
      await assert.rejects(
        run([command, 'run', 'binding:agent', '--input', input], agentProject, environment, 120000),
        /INVALID_RESULT/,
      )
      assert.equal(requests, 2) // One per invocation, including the unsuccessful one.
      // An ordinary consumer adds two authored methods around the unchanged
      // Agent. No private dispatch helper or special SDK entrypoint is involved.
      await mkdir(join(agentProject, 'libs/flow'), { recursive: true })
      await run(
        ['tar', '-xzf', sdkArchive, '--strip-components=1', '-C', join(agentProject, 'libs/flow')],
        consumer,
      )
      await writeFile(
        join(agentProject, 'package.json'),
        JSON.stringify({
          private: true,
          workspaces: ['flows/application', 'flows/specialist', 'libs/flow'],
        }),
      )
      for (const [name, slot, target] of [
        ['application', 'specialist', 'flow:flows/specialist'],
        ['specialist', 'agent', 'binding:agent'],
      ]) {
        const flow = join(agentProject, 'flows', name!)
        await mkdir(flow)
        await writeFile(
          join(flow, 'package.json'),
          JSON.stringify({
            name,
            private: true,
            type: 'module',
            dependencies: { '@jigging/flow': 'workspace:*' },
          }),
        )
        await writeFile(
          join(flow, 'FLOW.ts'),
          `import {handle} from '@jigging/flow';
await handle(run => run.call({operationId:'answer',slot:${JSON.stringify(slot)},input:run.input}));`,
        )
        if (name === 'specialist') {
          await mkdir(join(flow, 'contracts/agent/contracts'), { recursive: true })
          await writeFile(
            join(flow, 'contracts/agent/contract.json'),
            await readFile(join(agentProject, 'flows/agent/FLOW.contract.json')),
          )
          for (const name of [
            'acp-public-updates.json',
            'agent-commands.json',
            'agent-replies.json',
          ])
            await writeFile(
              join(flow, 'contracts/agent/contracts', name),
              await readFile(join(agentProject, 'flows/agent/contracts', name)),
            )
          await writeFile(
            join(flow, 'FLOW.meta.json'),
            JSON.stringify({ uses: { agent: { contract: './contracts/agent/contract.json' } } }),
          )
        }
        if (name === 'application')
          await writeFile(
            join(agentProject, 'bindings', `${name}.ts`),
            'import {defineBinding} from "@jigging/jig"; export default defineBinding(' +
              JSON.stringify({ package: `flows/${name}`, slots: { [slot!]: target } }) +
              ');',
          )
      }
      await run(
        [command, 'review', '--yes', '--allow-resolution-network'],
        agentProject,
        environment,
        120000,
      )
      mode = 'answer'
      // Execution uses retained effective routes, never the live default list.
      const admittedDeclaration = await readFile(join(agentProject, 'jig.ts'))
      await writeFile(join(agentProject, 'jig.ts'), 'throw new Error("not admitted");')
      const composed = await run(
        [command, 'run', 'binding:application', '--input', input],
        agentProject,
        environment,
        120000,
      )
      assert.deepEqual(JSON.parse(composed.stdout).output.structured, { category: 'support' })
      assert.equal(JSON.parse(composed.stdout).status, 'succeeded')
      mode = 'malformed'
      await assert.rejects(
        run(
          [command, 'run', 'binding:application', '--input', input],
          agentProject,
          environment,
          120000,
        ),
        /INVALID_RESULT/,
      )
      assert.equal(requests, 4)
      await writeFile(join(agentProject, 'jig.ts'), admittedDeclaration)
      // A Markdown consumer selects the same ordinary Agent, with no native
      // provider setup. The interpreter retains its independent decision gate.
      await mkdir(join(agentProject, 'flows/markdown'))
      await writeFile(join(agentProject, 'flows/markdown/FLOW.md'), 'Return the word READY.\n')
      await run(
        [command, 'review', '--yes', '--allow-resolution-network'],
        agentProject,
        environment,
        120000,
      )
      mode = 'markdown'
      const markdown = await run(
        [command, 'run', 'flow:flows/markdown', '--input', 'null'],
        agentProject,
        environment,
        120000,
      )
      assert.equal(JSON.parse(markdown.stdout).status, 'succeeded')
      assert.equal(JSON.parse(markdown.stdout).output, 'READY')
      mode = 'markdown-malformed'
      await assert.rejects(
        run(
          [command, 'run', 'flow:flows/markdown', '--input', 'null'],
          agentProject,
          environment,
          120000,
        ),
        /INVALID_RESULT/,
      )
      assert.equal(requests, 6)
      // The same installed package switches API syntax through settings. The
      // separately reviewed HTTP grant remains the only endpoint authority.
      await writeFile(
        join(agentProject, 'bindings/agent.ts'),
        'import {defineBinding} from "@jigging/jig"; export default defineBinding(' +
          JSON.stringify({
            package: 'flows/agent',
            settings: {
              model: 'recorded-model',
              api: 'responses',
              maxCompletionTokens: 32,
              structuredOutput: 'json-schema',
            },
            slots: {
              http: {
                kind: 'http',
                method: 'POST',
                url: `http://127.0.0.1:${server.port}/v1/responses`,
                bearerEnv: 'METHOD_TEST_TOKEN',
              },
            },
          }) +
          ');',
      )
      await run(
        [command, 'review', '--yes', '--allow-authority-changes', '--allow-resolution-network'],
        agentProject,
        environment,
        120000,
      )
      mode = 'answer'
      const response = await run(
        [command, 'run', 'flow:flows/specialist', '--input', input],
        agentProject,
        environment,
        120000,
      )
      assert.deepEqual(JSON.parse(response.stdout).output.structured, { category: 'support' })
      mode = 'malformed'
      await assert.rejects(
        run(
          [command, 'run', 'flow:flows/specialist', '--input', input],
          agentProject,
          environment,
          120000,
        ),
        /INVALID_RESULT/,
      )
      assert.equal(requests, 8)
    } finally {
      await server.stop(true)
    }
  }
  completed = true
} finally {
  if (completed) await rm(temporary, { recursive: true, force: true })
  else console.error(`Package smoke failed; retained consumer and artifacts at ${temporary}`)
}

async function selectArchive(
  artifacts: string,
  packageName: 'jig' | 'flow-sdk' | 'agent-method' = 'jig',
): Promise<string> {
  const variable =
    packageName === 'jig'
      ? 'JIG_PACKAGE_ARCHIVE'
      : packageName === 'agent-method'
        ? 'AGENT_METHOD_PACKAGE_ARCHIVE'
        : 'FLOW_SDK_PACKAGE_ARCHIVE'
  const supplied = process.env[variable]
  if (supplied !== undefined) {
    if (!isAbsolute(supplied) || supplied.includes('\0') || !supplied.endsWith('.tgz')) {
      throw new Error(`${variable} must name one absolute .tgz file`)
    }
    const canonical = await realpath(supplied)
    if (canonical !== supplied || !(await stat(canonical)).isFile()) {
      throw new Error(`${variable} must name one canonical regular file`)
    }
    return canonical
  }
  await run(
    packageName !== 'flow-sdk'
      ? ['bun', 'scripts/pack.ts', '--destination', artifacts]
      : ['bun', 'pm', 'pack', '--ignore-scripts', '--destination', artifacts],
    resolve(packageRoot, '..', packageName),
  )
  const archives = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
  assert.equal(archives.length, 1)
  return join(artifacts, archives[0]!)
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (path === 'libexec/authoring/node_modules') continue
    if (entry.isDirectory()) output.push(...(await listFiles(root, path)))
    else if (entry.isFile()) output.push(path)
    else throw new Error(`installed package contains a non-file member: ${path}`)
  }
  return output.sort()
}

async function run(
  command: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = {},
  timeoutMs = 30_000,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timeout = setTimeout(() => child.kill(), timeoutMs)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).finally(() => clearTimeout(timeout))
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${exitCode})\n${stdout}${stderr}`)
  }
  return { stdout, stderr }
}

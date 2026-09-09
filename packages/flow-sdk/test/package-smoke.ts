import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const packageRoot = resolve(import.meta.dir, '..')
const temporary = await mkdtemp(join(tmpdir(), 'flow-sdk-package-'))
const bun = process.execPath

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
      dependencies: { '@jigging/flow': `file:${archive}` },
    }),
  )
  await run(
    [
      bun,
      'install',
      '--ignore-scripts',
      '--no-progress',
      '--cache-dir',
      join(temporary, 'bun-cache'),
      '--backend',
      'copyfile',
      '--network-concurrency',
      '1',
    ],
    consumer,
  )

  const installed = join(consumer, 'node_modules', '@jigging', 'flow')
  assert.deepEqual((await readdir(installed)).sort(), [
    'LICENSE',
    'README.md',
    'dist',
    'package.json',
  ])
  assert.deepEqual((await readdir(join(installed, 'dist'))).sort(), [
    'channels.d.ts',
    'channels.js',
    'index.d.ts',
    'index.js',
    'json.d.ts',
    'json.js',
    'protocol.d.ts',
    'protocol.js',
    'session.d.ts',
    'session.js',
    'transport.d.ts',
    'transport.js',
    'types.d.ts',
    'types.js',
  ])
  const readme = await readFile(join(installed, 'README.md'), 'utf8')
  assert.doesNotMatch(readme, /\]\((?:\.\.\/)+docs\//)

  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >
  assert.equal(Object.hasOwn(manifest, 'private'), false)
  assert.equal(manifest.version, '0.1.0-alpha.10')
  assert.equal(Object.hasOwn(manifest, 'scripts'), false)
  assert.equal(manifest.license, 'Apache-2.0')
  assert.deepEqual(manifest.publishConfig, { access: 'public' })
  assert.equal(manifest.types, './dist/index.d.ts')

  await writeFile(
    join(consumer, 'smoke.mjs'),
    `import { CapabilityError, OperationError, handle } from "@jigging/flow";
const operation = new OperationError("UNAVAILABLE");
const effect = new CapabilityError("not-found", null);
if (
  operation.code !== "UNAVAILABLE" ||
  effect.errorName !== "not-found" ||
  typeof handle !== "function"
) {
  throw new Error("installed runtime exports are invalid");
}
`,
  )
  await run([bun, 'smoke.mjs'], consumer)
  const node = Bun.env.FLOW_NODE
  if (node === undefined || node === '' || !isAbsolute(node)) {
    throw new Error('Node was not supplied; set FLOW_NODE to its exact executable')
  }
  const nodeIdentity = await run(
    [
      node,
      '-e',
      'if (process.release?.name !== "node" || process.versions?.bun !== undefined) process.exit(70); process.stdout.write("FLOW_NODE_OK\\n")',
    ],
    packageRoot,
  )
  assert.equal(nodeIdentity.stdout, 'FLOW_NODE_OK\n')
  assert.equal(nodeIdentity.stderr, '')
  await run([node, 'smoke.mjs'], consumer)

  await writeFile(
    join(consumer, 'root-flow.mjs'),
    `import { handle } from "@jigging/flow";
await handle(async (run) => {
  if (typeof run.runChildFlow !== "function" || typeof run.callCapability !== "function" ||
      typeof run.channel !== "function" || Object.keys(run.channels).length !== 0) {
    throw new Error("installed RunContext methods are unavailable");
  }
  console.log("packed handler log");
  return {
    outcome: "done",
    output: { input: run.input, settings: run.settings },
  };
});
console.log("packed after handle");
`,
  )
  const request = `${JSON.stringify({
    jsonrpc: '2.0',
    id: 'package:smoke',
    method: 'flow/run',
    params: {
      protocol: 'run/1',
      input: { source: 'packed-archive' },
      settings: { mode: 'root-only' },
      attachments: {},
      scratch: '/tmp/flow-sdk-package-smoke',
      deadlineUnixMs: 4_000_000_000_000,
    },
  })}\n`
  for (const runtime of [bun, node]) {
    const handled = await run([runtime, 'root-flow.mjs'], consumer, request, true)
    assert.equal(handled.stderr, 'packed handler log\npacked after handle\n')
    assert.deepEqual(JSON.parse(handled.stdout), {
      jsonrpc: '2.0',
      id: 'package:smoke',
      result: {
        outcome: 'done',
        output: {
          input: { source: 'packed-archive' },
          settings: { mode: 'root-only' },
        },
      },
    })
  }

  await writeFile(
    join(consumer, 'application.mjs'),
    `console.log("packed application top-level log");
const cachedLog = console.log.bind(console);
export function runFlow(run) {
  cachedLog("packed application cached log");
  return { outcome: "done", output: { input: run.input } };
}
`,
  )
  await writeFile(
    join(consumer, 'dynamic-root-flow.mjs'),
    `import { handle } from "@jigging/flow";
await handle(async (run) => {
  const { runFlow } = await import("./application.mjs");
  return runFlow(run);
});
`,
  )
  for (const runtime of [bun, node]) {
    const handled = await run([runtime, 'dynamic-root-flow.mjs'], consumer, request, true)
    assert.equal(
      handled.stderr,
      'packed application top-level log\npacked application cached log\n',
    )
    assert.deepEqual(JSON.parse(handled.stdout), {
      jsonrpc: '2.0',
      id: 'package:smoke',
      result: {
        outcome: 'done',
        output: { input: { source: 'packed-archive' } },
      },
    })
  }

  await writeFile(
    join(consumer, 'smoke.ts'),
    `import { CapabilityError, OperationError, type CallOptions, type ChildFlowRequest, type CapabilityCall, type ChannelBroadcast, type ChannelContractIdentity, type ChannelEndpoint, type ChannelOptions, type ChannelPair, type ChannelReceiver, type ChannelSender, type JsonValue, type RunContext, type RunHandler, type RunResult } from "@jigging/flow";
const child: ChildFlowRequest = { operationId: "child:1", slot: "reviewer", input: null };
const capability: CapabilityCall = {
    operationId: "smoke:1",
    slot: "clock",
    method: "now",
    input: null,
};
const handler: RunHandler = async (run) => {
  const result = await run.runChildFlow(child);
  await run.callCapability(capability);
  return result;
};
void new CapabilityError("not-found", null);
void handler;
const runResult: RunResult = {
  outcome: "done",
  output: { value: 1 },
};
const directJson: JsonValue = runResult;
const nestedJson: JsonValue = { result: runResult };
void directJson;
void nestedJson;
void new OperationError("UNAVAILABLE");
void new OperationError("LAGGED");
void new OperationError("DISCONNECTED");

async function channelTypes(run: RunContext, options: CallOptions): Promise<RunResult> {
  const source: ChannelOptions = { schema: { type: "string" }, delivery: "direct" };
  const pair: ChannelPair = await run.channel(source, options);
  const sender: ChannelSender = pair.send;
  const receiver: ChannelReceiver = pair.receive;
  const identity: ChannelContractIdentity | undefined = receiver.contract;
  const endpoints: Readonly<Record<string, ChannelEndpoint>> = { events: sender };
  const work = run.callCapability({ ...capability, channels: endpoints }, options);
  for await (const value of receiver) console.log(value);
  await receiver.close(options);
  const result = await work;
  const output = run.channels.output;
  if (output?.direction === "send") {
    await output.send(result, options);
    await output.close(options);
  }
  const item: IteratorResult<JsonValue> = await receiver.next(options);
  const childResult = await run.runChildFlow({ ...child, channels: {} }, options);
  const direct: ChannelPair = await run.channel();
  const broadcast: ChannelBroadcast = await run.channel({ delivery: "broadcast" }, options);
  const subscribed: ChannelReceiver = await broadcast.subscribe(options);
  const delivery: "direct" | "broadcast" = subscribed.delivery;
  const selectedOptions: ChannelOptions = Math.random() > 0.5 ? { delivery: "broadcast" } : {};
  const selected: ChannelPair | ChannelBroadcast = await run.channel(selectedOptions, options);
  // @ts-expect-error Subscription authority is not an endpoint.
  const notAnEndpoint: ChannelEndpoint = broadcast;
  void direct;
  void delivery;
  void selected;
  void notAnEndpoint;
  void identity;
  void item;
  return childResult;
}
void channelTypes;
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
      bun,
      join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      join(consumer, 'tsconfig.json'),
    ],
    packageRoot,
  )
} finally {
  await rm(temporary, { recursive: true, force: true })
}

async function selectArchive(artifacts: string): Promise<string> {
  const supplied = Bun.env.FLOW_SDK_PACKAGE_ARCHIVE
  if (supplied !== undefined) {
    if (!isAbsolute(supplied) || supplied.includes('\0') || !supplied.endsWith('.tgz')) {
      throw new Error('FLOW_SDK_PACKAGE_ARCHIVE must name one absolute .tgz file')
    }
    const canonical = await realpath(supplied)
    if (canonical !== supplied || !(await stat(canonical)).isFile()) {
      throw new Error('FLOW_SDK_PACKAGE_ARCHIVE must name one canonical regular file')
    }
    return canonical
  }
  await run([bun, 'pm', 'pack', '--ignore-scripts', '--destination', artifacts], packageRoot)
  const packed = (await readdir(artifacts)).filter((name) => name.endsWith('.tgz'))
  assert.equal(packed.length, 1)
  return join(artifacts, packed[0]!)
}

async function run(
  command: string[],
  cwd: string,
  input?: string,
  keepInputOpen = false,
): Promise<{
  readonly stdout: string
  readonly stderr: string
}> {
  const process = Bun.spawn(command, {
    cwd,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (input !== undefined) process.stdin.write(input)
  if (!keepInputOpen) process.stdin.end()
  const timeout = setTimeout(() => process.kill(), 30_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]).finally(() => clearTimeout(timeout))
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${exitCode})\n${stdout}${stderr}`)
  }
  return { stdout, stderr }
}

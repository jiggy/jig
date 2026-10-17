import assert from 'node:assert/strict'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const installedRuntime =
  process.platform === 'darwin'
    ? Object.freeze({
        package: process.arch === 'arm64' ? 'bun-darwin-aarch64' : 'bun-darwin-x64-baseline',
        version: '1.4.2',
        revision: '1.4.2+744846f84',
        sha256:
          process.arch === 'arm64'
            ? '35d20dd0263e5c950194434b925454fdfa9ba6e4467da960410fa05b08a7a5b5'
            : '2fa513af22ac59e03aae640cad302e73cb1ddb0f6398501e2ddccf7dcd613596',
      })
    : Object.freeze({
        package: 'bun-linux-x64-baseline',
        version: '1.3.3',
        revision: '1.3.3+274e01c73',
        sha256: 'e666c943af70078a72bad00757a094776a54621fecd83eb4aa982760f9186839',
      })
export const expectedInstalledFiles = [
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
  'dist/attempt-contract.d.ts',
  'dist/client.d.ts',
  'dist/client.js',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/json.d.ts',
  'dist/project/author.d.ts',
  'dist/project/commands.d.ts',
  'dist/project/evaluation.d.ts',
  'dist/project/grants.d.ts',
  'dist/schema/types.d.ts',
  'libexec/installed-cli.js',
  'libexec/image-preview-worker.js',
  'libexec/authoring/contract-authoring-worker.js',
  'libexec/markdown-runtime.js',
  'libexec/http-request-worker.js',
  'libexec/flow.LICENSE',
  'libexec/contracts/reporting/reporting.json',
  'libexec/contracts/reporting/LICENSE',
  ...[
    'agent-run',
    'project-command',
    'project-evaluation',
    'http-request',
    'run-checkpoint',
    'finite-acp',
  ].flatMap((name) => [
    `libexec/contracts/${name}/contract.json`,
    `libexec/contracts/${name}/LICENSE`,
  ]),
  'libexec/contracts/agent-run/contracts/acp-public-updates.json',
  'libexec/contracts/agent-run/contracts/agent-commands.json',
  'libexec/contracts/agent-run/contracts/agent-replies.json',
  'libexec/contracts/finite-acp/requests.json',
  'libexec/contracts/finite-acp/responses.json',
  'libexec/contracts/acp-public-updates/acp-public-updates.json',
  'libexec/contracts/acp-public-updates/LICENSE',
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
  'libexec/macos-native-supervisor.js',
  'libexec/macos-exec',
  'libexec/macos-codex-preferences',
  'libexec/macos-descriptor-bridge.dylib',
  'package.json',
].sort()

export type InstalledDisplayCommand = (
  command: string[],
  cwd: string,
  environment?: NodeJS.ProcessEnv,
  timeoutMs?: number,
) => Promise<{ readonly stdout: string; readonly stderr: string }>

/** Ordinary installed UI checks shared by the full consumer and the partial witness. */
export async function checkInstalledDisplay({
  consumer,
  installed,
  runtime,
  command,
  run,
  requireRunRefusal = true,
}: {
  consumer: string
  installed: string
  runtime: string
  command: string
  run: InstalledDisplayCommand
  requireRunRefusal?: boolean
}): Promise<void> {
  const canProveRunRefusal =
    process.platform === 'darwin' ||
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1')
  assert(
    !requireRunRefusal || canProveRunRefusal,
    'Installed display Run refusal requires the qualified Mac or provisioned Linux host',
  )
  // The ordinary script-disabled install must retain Core's native and peer
  // closure. Plain commands and public authoring do not import that renderer.
  const rendererCheck = join(consumer, 'renderer-check.mjs')
  await writeFile(
    rendererCheck,
    `import { createRequire } from 'node:module';
const resolve = createRequire(${JSON.stringify(join(installed, 'package.json'))});
const path = resolve.resolve('@opentui/core');
const core = await import(path);
const buffer = core.OptimizedBuffer.create(1, 1, 'unicode');
buffer.destroy();
console.log(path);
`,
  )
  const renderer = await run([runtime, rendererCheck], consumer)
  const rendererDirectory = resolve(renderer.stdout.trim(), '..')
  const rendererManifest = JSON.parse(
    await readFile(join(rendererDirectory, 'package.json'), 'utf8'),
  )
  assert.equal(rendererManifest.version, '0.5.17')
  const hiddenRenderer = `${rendererDirectory}.missing-test`
  await rename(rendererDirectory, hiddenRenderer)
  try {
    assert.match((await run([command, '--help'], consumer)).stdout, /Jig runs reusable methods/)
    const authoringCheck = join(consumer, 'authoring-without-renderer.mjs')
    await writeFile(
      authoringCheck,
      "import { defineJig } from '@jigging/jig';\nconsole.log(typeof defineJig);\n",
    )
    assert.equal((await run([runtime, authoringCheck], consumer)).stdout, 'function\n')
    // Linux delegation precedes renderer preparation. Ordinary source CI owns
    // the non-Run checks; qualified host callers must prove this refusal.
    if (canProveRunRefusal) {
      const tuiRefusal = await run(
        [
          process.env.PYTHON ?? 'python3',
          join(import.meta.dir, 'installed-tui-refusal.py'),
          command,
        ],
        consumer,
        {},
        45_000,
      )
      assert.equal(JSON.parse(tuiRefusal.stdout).passed, true)
      assert.equal(tuiRefusal.stderr, '')
    }
    // Saved inspection needs terminal stdout as well as terminal stderr. The
    // test-only PTY owner keeps the capability in memory and emits sanitized
    // evidence; no project, execution host or native renderer is involved.
    const web = await run(
      [
        process.env.PYTHON ?? 'python3',
        join(import.meta.dir, 'installed-saved-web.py'),
        command,
        join(consumer, 'saved-web-packet'),
      ],
      consumer,
      {},
      90_000,
    )
    assert.deepEqual(JSON.parse(web.stdout), {
      passed: true,
      checks: [
        'embedded-assets',
        'bearer-required',
        'recorded-capture',
        'immutable-previews',
        'captured-svg-fallback',
        'exact-origin-close',
        'piped-input',
        'joined-exit',
        'capability-redaction',
      ],
    })
    assert.equal(web.stderr, '')
  } finally {
    await rename(hiddenRenderer, rendererDirectory)
  }
  const tui = await run(
    [
      process.env.PYTHON ?? 'python3',
      join(import.meta.dir, 'installed-saved-tui.py'),
      command,
      join(consumer, 'saved-tui-packet'),
    ],
    consumer,
    {},
    90_000,
  )
  assert.deepEqual(JSON.parse(tui.stdout), {
    passed: true,
    checks: [
      'native-screen',
      'recorded-files',
      'captured-preview',
      'joined-close',
      'screen-restored',
      'input-restored',
    ],
  })
  assert.equal(tui.stderr, '')
}

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostTest =
  process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ||
  (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
    ? test
    : test.skip
const cli = fileURLToPath(new URL('../bin/jig', import.meta.url))
const contract = {
  $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
  id: 'https://example.org/contracts/echo',
  version: '1.0.0',
}

// Minimal independently authored Run/0 peer: no private host imports or copied SDK.
const peer = `import marker from 'is-number/jig-patch.js';
if(marker !== 'captured patch') throw new Error('dependency patch was not applied');
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
for await (const line of lines) {
 const request=JSON.parse(line);
 if(request.method!=='flow/run') throw new Error('unexpected request');
 console.error('dependency diagnostic');
 if(request.params.input==='hold') await new Promise(resolve=>setTimeout(resolve,60000));
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{outcome:'done',output:request.params.input}})+'\\n');
 break;
}
`

const caller = `import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin}); let root;
for await (const line of lines) {
 const message=JSON.parse(line);
 if(!root) {
  root=message;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:'child',method:'flow/call',params:{operationId:'echo',slot:'worker',input:root.params.input}})+'\\n');
 } else {
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:root.id,...(message.error?{error:message.error}:{result:message.result})})+'\\n');
  break;
 }
}
`

hostTest.each([false, true])(
  'installed CLI reviews and runs a workspace dependency (root application: %s)',
  async (rootApplication) => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-npm-consumer-'))
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(
        join(directory, path),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    const project = rootApplication ? directory : join(directory, 'apps/consumer')
    const putApp = (path: string, value: unknown) =>
      put(rootApplication ? path : `apps/consumer/${path}`, value)
    const run = async (args: string[], interrupt = false) => {
      const child = Bun.spawn([cli, ...args], {
        cwd: project,
        env: { ...process.env, NO_COLOR: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const stderrText = async () => {
        let text = '',
          interrupted = false
        for await (const chunk of child.stderr) {
          text += new TextDecoder().decode(chunk)
          if (interrupt && !interrupted && text.includes('dependency diagnostic')) {
            interrupted = true
            child.kill('SIGINT')
          }
        }
        return text
      }
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        stderrText(),
      ])
      return { exit, stdout, stderr }
    }
    let passed = false
    try {
      await put('package.json', {
        private: true,
        workspaces: ['apps/*', 'packages/*'],
        patchedDependencies: { 'is-number@6.0.0': 'patches/is-number.patch' },
        ...(rootApplication
          ? { name: 'consumer', type: 'module', dependencies: { 'echo-method': 'workspace:*' } }
          : {}),
      })
      await put(
        'patches/is-number.patch',
        [
          'diff --git a/jig-patch.js b/jig-patch.js',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/jig-patch.js',
          '@@ -0,0 +1 @@',
          '+module.exports = "captured patch";',
          '',
        ].join('\n'),
      )
      if (!rootApplication)
        await putApp('package.json', {
          name: 'consumer',
          type: 'module',
          dependencies: { 'echo-method': 'workspace:*' },
        })
      await putApp(
        'jig.ts',
        `import {defineJig,discover} from '@jigging/jig'; export default defineJig({ flows:discover('flows'),bindings:discover('bindings'), defaultProviders: { 'https://example.org/contracts/echo': 'npm:echo-method' } });`,
      )
      await putApp('flows/caller/FLOW.ts', caller)
      await putApp('flows/caller/FLOW.meta.json', {
        uses: { worker: { contract: './echo.json' } },
      })
      await putApp('flows/caller/echo.json', contract)
      await putApp(
        'bindings/echo.ts',
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'npm:echo-method'});`,
      )
      await put('packages/echo/package.json', {
        name: 'echo-method',
        version: '1.0.0',
        type: 'module',
        files: ['FLOW.ts', 'FLOW.contract.json'],
        dependencies: { 'is-number': '6.0.0' },
      })
      await put('packages/echo/FLOW.ts', peer)
      await put('packages/echo/FLOW.contract.json', contract)
      const review = await run(['review', '--yes', '--allow-resolution-network'])
      expect(review.exit, review.stdout + review.stderr).toBe(0)
      const result = await run([
        'run',
        'npm:echo-method',
        '--input',
        '"declared package"',
        '--json',
      ])
      expect(result.exit, result.stdout + result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        output: 'declared package',
      })
      for (const target of ['binding:echo', 'flow:flows/caller']) {
        const invoked = await run([
          'run',
          target,
          '--input',
          '"through selected provider"',
          '--json',
        ])
        expect(invoked.exit, invoked.stdout + invoked.stderr).toBe(0)
        expect(JSON.parse(invoked.stdout)).toMatchObject({
          status: 'succeeded',
          output: 'through selected provider',
        })
        expect(JSON.parse(invoked.stdout).runDiagnostics.entries).toContainEqual({
          operations: target === 'flow:flows/caller' ? ['echo'] : [],
          stderr: 'dependency diagnostic\n',
          stderrBytes: 22,
          stderrTruncated: false,
        })
      }
      const cancelled = await run(['run', 'npm:echo-method', '--input', '"hold"', '--json'], true)
      expect(cancelled.exit, cancelled.stderr).toBe(2)
      expect(JSON.parse(cancelled.stdout)).toMatchObject({
        status: 'failed',
        code: 'CANCELLED',
        command: { status: 'interrupted' },
      })
      const inspect = await run(['inspect', 'npm:echo-method', '--json'])
      expect(inspect.exit, inspect.stderr).toBe(0)
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        target: 'npm:echo-method',
        contract: { id: contract.id },
      })
      const before = await readFile(join(project, 'jig.lock'), 'utf8')
      const originalPatch = await readFile(join(directory, 'patches/is-number.patch'), 'utf8')
      await put('packages/echo/FLOW.ts', 'throw new Error("unreviewed source must not run")')
      await put('patches/is-number.patch', 'unreviewed patch must not replace retained bytes')
      const pinned = await run(['run', 'npm:echo-method', '--input', '"retained"', '--json'])
      expect(pinned.exit, pinned.stdout + pinned.stderr).toBe(0)
      expect(JSON.parse(pinned.stdout)).toMatchObject({ output: 'retained' })
      expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(before)
      await put('patches/is-number.patch', originalPatch)
      // Review retains its generated lock privately; an authored stale lock
      // must be created through Bun before changing the manifest.
      execFileSync(
        process.execPath,
        ['--no-env-file', 'install', '--lockfile-only', '--ignore-scripts', '--config=/dev/null'],
        {
          cwd: directory,
          timeout: 30_000,
          stdio: 'pipe',
        },
      )
      const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
      await putApp('package.json', { ...manifest, name: 'changed-without-updating-lock' })
      const stale = await run(['review', '--yes'])
      expect(stale.exit, stale.stdout + stale.stderr).not.toBe(0)
      expect(stale.stderr).toContain('PACKAGE_BUN_LOCK_STALE')
      expect(stale.stderr).toContain('/name')
      expect(stale.stderr).not.toContain('changed-without-updating-lock')
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Preserved package-provider consumer: ${directory}`)
    }
  },
  120_000,
)

import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostTest = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? test : test.skip
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

hostTest(
  'packed project entrypoint uses reviewed defaults and fresh job data',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-entrypoint-consumer-'))
    const packageRoot = join(import.meta.dir, '..')
    const project = join(directory, 'project')
    const tooling = join(directory, 'tooling')
    const artifacts = join(directory, 'artifacts')
    let passed = false
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(project, path)), { recursive: true })
      await writeFile(
        join(project, path),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    try {
      await mkdir(tooling)
      await mkdir(artifacts)
      let archive = process.env.JIG_PACKAGE_ARCHIVE
      if (!archive) {
        execFileSync(process.execPath, ['scripts/pack.ts', '--destination', artifacts], {
          cwd: packageRoot,
          stdio: 'pipe',
          timeout: 120000,
        })
        const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
        archive = join(artifacts, `jigging-jig-${manifest.version}.tgz`)
      }
      await writeFile(
        join(tooling, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: { '@jigging/jig': `file:${archive}` },
        }),
      )
      execFileSync(
        process.execPath,
        ['install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
        {
          cwd: tooling,
          stdio: 'pipe',
          timeout: 120000,
        },
      )
      const installed = join(tooling, 'node_modules/.bin/jig')
      let sequence = 0
      const invoke = async (args: string[]) => {
        const child = Bun.spawn([installed, ...args], {
          cwd: project,
          env: { ...process.env, NO_COLOR: '1' },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const timer = setTimeout(() => child.kill('SIGTERM'), 120000)
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]).finally(() => clearTimeout(timer))
        await writeFile(
          join(directory, `${++sequence}-${args[0]}.json`),
          JSON.stringify({ args, exit, stdout, stderr }, null, 2),
        )
        return { exit, stdout, stderr }
      }
      const succeed = async (args: string[]) => {
        const result = await invoke(args)
        expect(result.exit, result.stdout + result.stderr).toBe(0)
        return result
      }
      const declaration = (entrypoint: string) => `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings'),entrypoint:${JSON.stringify(entrypoint)}});`
      const echo = `import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
for await (const line of lines) {
 const request=JSON.parse(line);
 const {input,attachments}=request.params;
 let output=input;
 if(attachments.source) {
  const source=await Bun.file(attachments.source.path+'/value.txt').text();
  output={input,source};
  await Bun.write(attachments.result.path+'/copy.txt',source);
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{outcome:'done',output}})+'\\n');
 break;
}`
      await put('package.json', { private: true, type: 'module' })
      await put('flows/echo/FLOW.ts', echo)
      await put('flows/files/FLOW.ts', echo)
      await put('flows/files/FLOW.contract.json', {
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        input: {
          type: 'object',
          properties: { job: { type: 'string', enum: ['first', 'second'] } },
          required: ['job'],
          additionalProperties: false,
        },
        attachments: { source: 'read', result: 'read-write' },
      })
      await put(
        'bindings/factory.ts',
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/files'});`,
      )
      await put(
        'jig.ts',
        declaration(
          `binding:factory --input '@job data.json' --attach 'source=source files' --out result --timeout 30s`,
        ),
      )
      await put('job data.json', { job: 'first' })
      await put('source files/value.txt', 'original')
      const review = await succeed(['review', '--yes'])
      expect(review.stdout).toContain('Project entrypoint')
      const inspection = JSON.parse((await succeed(['inspect', '--json'])).stdout)
      expect(inspection.entrypoint).toContain('binding:factory --input')
      // Unreviewed source must not affect selection or cause reevaluation.
      await put('jig.ts', 'throw new Error("unreviewed source must not execute")')
      const first = JSON.parse((await succeed(['run', '--json'])).stdout)
      expect(first).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        output: { input: { job: 'first' }, source: 'original' },
      })
      const occupied = await invoke(['run', '--json'])
      expect(occupied.exit).not.toBe(0)
      expect(occupied.stderr).toContain('JIG_OUTPUT_EXISTS')
      await put('job data.json', { job: 'second' })
      await put('source files/value.txt', 'fresh')
      const second = JSON.parse(
        (await succeed(['run', '--out', 'second-result', '--timeout', '45s', '--json'])).stdout,
      )
      expect(second).toMatchObject({
        status: 'succeeded',
        output: { input: { job: 'second' }, source: 'fresh' },
      })
      // Explicit targets bypass all defaults, including the occupied output.
      const direct = JSON.parse(
        (await succeed(['run', 'flow:flows/echo', '--input', '"direct"', '--json'])).stdout,
      )
      expect(direct).toMatchObject({ status: 'succeeded', output: 'direct' })
      const sameTarget = await invoke(['run', 'binding:factory', '--json'])
      expect(sameTarget.exit).not.toBe(0)
      expect(sameTarget.stdout + sameTarget.stderr).not.toContain('JIG_OUTPUT_EXISTS')
      expect(sameTarget.stdout + sameTarget.stderr).toContain('JIG_RUN_FILES_INVALID')
      // An invalid job remains invalid after a fresh review. Recovery guidance
      // names the approved schema without diagnosing source freshness.
      await put('job data.json', { job: 'third' })
      await put(
        'jig.ts',
        declaration(
          `binding:factory --input '@job data.json' --attach 'source=source files' --out result --timeout 30s`,
        ),
      )
      for (const output of ['rejected-before-review', 'rejected-after-review']) {
        if (output === 'rejected-after-review') await succeed(['review', '--yes'])
        const rejected = await invoke(['run', '--out', output, '--json'])
        expect(rejected.exit).toBe(1)
        expect(rejected.stderr).toContain('approved target input schema')
        expect(rejected.stderr).toContain('choices declared')
        expect(rejected.stderr).toContain('If you edited the Flow or its schema')
        expect(rejected.stderr).not.toContain('Review required')
        const terminal = JSON.parse(rejected.stdout)
        expect(terminal).toMatchObject({
          status: 'failed',
          code: 'INVALID_INPUT',
          details: { keyword: 'enum', instancePointer: '/job' },
        })
        expect(terminal.input.attachments[0].files[0].path).toBe('value.txt')
        const packet = JSON.parse(await readFile(join(project, output, 'result.json'), 'utf8'))
        expect(packet.details).toEqual(terminal.details)
        expect(packet.method).toEqual(terminal.method)
        expect(packet.input).toEqual(terminal.input)
      }
      await put('jig.ts', declaration('flow:flows/echo'))
      await succeed(['review', '--yes'])
      const short = JSON.parse((await succeed(['run', '--input', '"short"', '--json'])).stdout)
      expect(short).toMatchObject({ status: 'succeeded', output: 'short' })
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Entrypoint consumer evidence retained at ${directory}`)
    }
  },
  600000,
)

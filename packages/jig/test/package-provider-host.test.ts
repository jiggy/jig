import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const hostTest = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? test : test.skip
const cli = fileURLToPath(new URL('../bin/jig', import.meta.url))
const contract = {
  $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
  id: 'https://example.org/contracts/echo',
  version: '1.0.0',
}

// Minimal independently authored Run/1 peer: no private host imports or copied SDK.
const peer = `import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
for await (const line of lines) {
 const request=JSON.parse(line);
 if(request.method!=='flow/run') throw new Error('unexpected request');
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

hostTest(
  'installed CLI reviews and runs a workspace Flow dependency without package copies',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-npm-consumer-'))
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(
        join(directory, path),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    const project = join(directory, 'apps/consumer')
    const run = async (args: string[]) => {
      const child = Bun.spawn([cli, ...args], {
        cwd: project,
        env: { ...process.env, NO_COLOR: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exit, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      return { exit, stdout, stderr }
    }
    let passed = false
    try {
      await put('package.json', { private: true, workspaces: ['apps/*', 'packages/*'] })
      await put('apps/consumer/package.json', {
        name: 'consumer',
        type: 'module',
        dependencies: { 'echo-method': 'workspace:*' },
      })
      await put(
        'apps/consumer/jig.ts',
        `import {defineJig,discover} from '@jigging/jig'; export default defineJig({ flows:discover('flows'),bindings:discover('bindings'), defaultProviders: { 'https://example.org/contracts/echo': 'npm:echo-method' } });`,
      )
      await put('apps/consumer/flows/caller/FLOW.ts', caller)
      await put('apps/consumer/flows/caller/flow.meta.json', {
        uses: { worker: { contract: './echo.json' } },
      })
      await put('apps/consumer/flows/caller/echo.json', contract)
      await put(
        'apps/consumer/bindings/echo.ts',
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'npm:echo-method'});`,
      )
      await put('packages/echo/package.json', {
        name: 'echo-method',
        version: '1.0.0',
        type: 'module',
        files: ['FLOW.ts', 'FLOW.contract.json'],
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
      }
      const inspect = await run(['inspect', 'npm:echo-method', '--json'])
      expect(inspect.exit, inspect.stderr).toBe(0)
      expect(JSON.parse(inspect.stdout)).toMatchObject({
        target: 'npm:echo-method',
        contract: { id: contract.id },
      })
      const before = await readFile(join(project, 'jig.lock'), 'utf8')
      await put('packages/echo/FLOW.ts', 'throw new Error("unreviewed source must not run")')
      const pinned = await run(['run', 'npm:echo-method', '--input', '"retained"', '--json'])
      expect(pinned.exit, pinned.stdout + pinned.stderr).toBe(0)
      expect(JSON.parse(pinned.stdout)).toMatchObject({ output: 'retained' })
      expect(await readFile(join(project, 'jig.lock'), 'utf8')).toBe(before)
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Preserved package-provider consumer: ${directory}`)
    }
  },
  120_000,
)

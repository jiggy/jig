import { constants, Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACOS_FIXTURE_RUN_MS, MACOS_FIXTURE_SETTLEMENT_MS } from './fixtures/agent-fixture-host.js'
import { settleTestCommand } from './fixtures/bounded-command.js'

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

hostTest(
  'installed software factory delivers complete blocked and checked dashboard views',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-factory-consumer-'))
    const project = join(directory, 'project')
    const tooling = join(directory, 'tooling')
    const artifacts = join(directory, 'artifacts')
    const evidence = join(directory, 'commands')
    const packageRoot = join(import.meta.dir, '..')
    const example = join(packageRoot, '../../examples/software-factory')
    let passed = false
    let sequence = 0
    await mkdir(evidence)
    const command = async (args: string[], cwd: string) => {
      const child = Bun.spawn(args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const result = await settleTestCommand(child, {
        evidence: join(evidence, String(++sequence)),
        timeoutMs: MACOS_FIXTURE_SETTLEMENT_MS,
      })
      expect(result.code, result.stdout + result.stderr).toBe(0)
      return result.stdout
    }
    const archive = async (name: string, variable: string) => {
      const supplied = process.env[variable]
      if (supplied) return supplied
      const destination = join(artifacts, name)
      await mkdir(destination, { recursive: true })
      await command(
        name === 'jig'
          ? [process.execPath, 'scripts/pack.ts', '--destination', destination]
          : [process.execPath, 'pm', 'pack', '--ignore-scripts', '--destination', destination],
        join(packageRoot, '..', name),
      )
      const manifest = JSON.parse(
        await readFile(join(packageRoot, '..', name, 'package.json'), 'utf8'),
      )
      return join(
        destination,
        `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`,
      )
    }
    try {
      await mkdir(tooling)
      await writeFile(
        join(tooling, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: { '@jigging/jig': `file:${await archive('jig', 'JIG_PACKAGE_ARCHIVE')}` },
        }),
      )
      await command(
        [process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'],
        tooling,
      )
      const installed = join(tooling, 'node_modules/.bin/jig')
      // Copy the authored application unchanged. Only operator composition is
      // replaced with a deterministic public Flow; no native client or model.
      await cp(example, project, {
        recursive: true,
        filter: (source) =>
          !['.jig', '.git', 'node_modules', 'factory-result'].includes(basename(source)),
      })
      const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
      manifest.workspaces.push('libs/*')
      await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
      for (const [name, variable] of [
        ['flow-sdk', 'FLOW_SDK_PACKAGE_ARCHIVE'],
        ['user-updates', 'USER_UPDATES_PACKAGE_ARCHIVE'],
        ['agent-method', 'AGENT_METHOD_PACKAGE_ARCHIVE'],
        ['agent-acp', 'AGENT_ACP_PACKAGE_ARCHIVE'],
      ] as const) {
        const library = join(project, 'libs', name)
        await mkdir(library, { recursive: true })
        await command(
          ['tar', '-xzf', await archive(name, variable), '--strip-components=1', '-C', library],
          project,
        )
      }
      const peer = join(project, 'flows/test-agent')
      await mkdir(peer)
      await cp(join(project, 'flows/repair/contracts/agent-run'), peer, { recursive: true })
      await writeFile(join(peer, 'FLOW.contract.json'), await readFile(join(peer, 'contract.json')))
      await writeFile(
        join(peer, 'package.json'),
        JSON.stringify({
          name: 'factory-test-agent',
          private: true,
          type: 'module',
          dependencies: { '@jigging/flow': 'workspace:*' },
        }),
      )
      const cause = 'Deterministic test peer declined to propose a patch.'
      await writeFile(
        join(peer, 'FLOW.ts'),
        `import {handle} from '@jigging/flow'; await handle(async () => ({outcome:'blocked',output:{text:${JSON.stringify(cause)}}}));`,
      )
      await writeFile(
        join(project, 'bindings/agent.ts'),
        "import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/test-agent'});",
      )
      await command(
        [process.execPath, 'install', '--ignore-scripts', '--backend', 'copyfile'],
        project,
      )
      await command(
        [installed, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'],
        project,
      )
      // Admitted bytes must suffice even when the editable sibling disappears.
      await rm(join(project, 'flows/repair'), { recursive: true })
      const stdout = await command(
        [
          installed,
          'run',
          '--receive',
          'progress',
          '--json',
          '--timeout',
          `${MACOS_FIXTURE_RUN_MS}ms`,
        ],
        project,
      )
      const records = stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const terminal = records.filter((record) => record.type === 'terminal')
      expect(terminal).toHaveLength(1)
      expect(terminal[0].result).toMatchObject({
        status: 'succeeded',
        outcome: 'blocked',
        delivery: { status: 'written' },
      })
      expect(terminal[0].result.output.jobs).toHaveLength(2)
      for (const job of terminal[0].result.output.jobs) {
        expect(job).toMatchObject({
          status: 'settled',
          ready: false,
          result: { outcome: 'blocked', output: { reason: cause } },
        })
        expect(job.result.output.baseline.acceptance).not.toHaveLength(0)
      }
      const updates = records
        .filter((record) => record.type === 'data')
        .map((record) => record.value)
      for (const id of ['jobs', 'checks', 'patches'])
        expect(updates.some((update) => update.kind === 'view' && update.id === id)).toBe(true)
      const finalJobs = updates
        .filter((update) => update.kind === 'view' && update.id === 'jobs')
        .at(-1)
      expect(finalJobs.summary).toContain('2 of 2 repairs settled')
      const finalChecks = updates
        .filter((update) => update.kind === 'view' && update.id === 'checks')
        .at(-1)
      expect(JSON.stringify(finalChecks)).not.toContain('Pending independent verification')
      expect(JSON.stringify(finalChecks)).toContain('Settled; no checked patch')
      const finalPatches = updates
        .filter((update) => update.kind === 'view' && update.id === 'patches')
        .at(-1)
      expect(finalPatches.summary).toContain('0 checked patches')
      expect(
        updates.some(
          (update) => update.kind === 'notice' && update.text.includes('Requested goal:'),
        ),
      ).toBe(true)
      expect(
        updates.some(
          (update) =>
            update.kind === 'view' &&
            update.id === 'jobs' &&
            JSON.stringify(update.sections).includes('repository test command'),
        ),
      ).toBe(true)
      expect(
        updates.some(
          (update) => update.kind === 'notice' && update.text.includes('Baseline check report:'),
        ),
      ).toBe(true)
      const packet = JSON.parse(await readFile(join(project, 'factory-result/result.json'), 'utf8'))
      expect(packet).toMatchObject({ status: 'succeeded', outcome: 'blocked' })
      expect(await readFile(join(project, 'factory-result/files/summary.txt'), 'utf8')).toContain(
        cause,
      )
      // A second reviewed ordinary peer returns deterministic fixture repairs.
      // The factory source, test commands and independent assertions stay unchanged.
      await cp(join(example, 'flows/repair'), join(project, 'flows/repair'), {
        recursive: true,
        filter: (source) => basename(source) !== 'node_modules',
      })
      await writeFile(
        join(peer, 'FLOW.ts'),
        `import {handle} from '@jigging/flow';
await handle(async run => {
 const instructions=run.input.instructions;
 const input=JSON.parse(instructions.slice(instructions.indexOf('\\n')+1));
 const replacements=input.editPaths.map(path=>{
   let content=input.files[path];
   if(path==='src/parse.ts'&&content.includes('parseTime')) content=content.replace('if (hour > 23)','if (hour > 23 || minute > 59)');
   else if(path==='src/parse.ts') content=content.replace("typeof value.status !== 'number'", "typeof value.status !== 'number' || !Number.isInteger(value.status) || value.status < 100 || value.status > 599");
   if(path==='src/report.ts') content=content.replace('r.status >= 400).length','r.status >= 500 && r.status < 600).length');
   if(path==='src/total.ts') content=content.replace('Math.max(0, shift.end - shift.start)','(shift.end - shift.start + 1440) % 1440');
   return {path,content};
 });
 return {outcome:'done',output:{text:'Deterministic fixture correction',structured:{summary:'Deterministic fixture correction',replacements}}};
});`,
      )
      await command(
        [installed, 'review', '--yes', '--allow-resolution-network', '--allow-authority-changes'],
        project,
      )
      const checked = (
        await command(
          [
            installed,
            'run',
            '--out',
            'factory-checked',
            '--receive',
            'progress',
            '--json',
            '--timeout',
            `${MACOS_FIXTURE_RUN_MS}ms`,
          ],
          project,
        )
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const checkedTerminal = checked.find((record) => record.type === 'terminal').result
      expect(checkedTerminal).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        delivery: { status: 'written' },
      })
      expect(checkedTerminal.output.jobs.every((job) => job.ready === true)).toBe(true)
      const checkedUpdates = checked
        .filter((record) => record.type === 'data')
        .map((record) => record.value)
      expect(
        checkedUpdates.filter((update) => update.kind === 'view' && update.id === 'jobs').at(-1)
          .summary,
      ).toContain('2 independently checked patches')
      expect(
        JSON.stringify(
          checkedUpdates
            .filter((update) => update.kind === 'view' && update.id === 'checks')
            .at(-1),
        ),
      ).toContain('Passed; independently verified')
      const patches = checkedUpdates
        .filter((update) => update.kind === 'view' && update.id === 'patches')
        .at(-1)
      expect(patches.summary).toContain('2 checked patches')
      expect(patches.sections[0].blocks[0].rows.map((row) => row.cells.patch)).toEqual([
        { kind: 'artifact', attachment: 'deliverables', path: 'logs/review.patch' },
        { kind: 'artifact', attachment: 'deliverables', path: 'timesheet/review.patch' },
      ])
      expect(checked.some((record) => record.type === 'end' && record.error !== undefined)).toBe(
        false,
      )
      const plain = JSON.parse(
        await command(
          [
            installed,
            'run',
            '--out',
            'factory-auto',
            '--display',
            'plain',
            '--timeout',
            `${MACOS_FIXTURE_RUN_MS}ms`,
          ],
          project,
        ),
      )
      expect(plain).toMatchObject({
        status: 'succeeded',
        outcome: 'done',
        delivery: { status: 'written' },
      })
      const transcript = await readFile(join(evidence, `${sequence}.stderr`), 'utf8')
      for (const title of ['Software factory · Jobs', 'Checks', 'Patches'])
        expect(transcript).toContain(title)
      expect(transcript).toContain('Observation ended')
      expect(transcript).not.toContain('\u001b')
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Software factory consumer evidence retained at ${directory}`)
    }
  },
  600_000,
)

hostTest.each(['member', 'root', 'nested'] as const)(
  'installed CLI reviews and runs a workspace dependency (application: %s)',
  async (location) => {
    const rootApplication = location === 'root'
    const nested = location === 'nested'
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
      // The host may retain Flow stderr until settlement, so it is not a
      // reliable signal that the held Run is still active.
      let interruptEvidence: { sent: boolean; error?: string } | undefined
      const interruptTimer = interrupt
        ? setTimeout(() => {
            try {
              process.kill(child.pid, 'SIGTERM')
              interruptEvidence = { sent: true }
            } catch (error) {
              interruptEvidence = {
                sent: false,
                error: error instanceof Error ? error.message : String(error),
              }
            }
          }, 20_000)
        : undefined
      try {
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        return { exit, stdout, stderr, interruptEvidence }
      } finally {
        if (interruptTimer !== undefined) clearTimeout(interruptTimer)
      }
    }
    let passed = false
    try {
      await put('package.json', {
        private: true,
        workspaces: ['apps/*', 'packages/*', ...(nested ? ['apps/*/flows/*'] : [])],
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
          dependencies: { 'echo-method': nested ? '1.0.0' : 'workspace:*' },
          ...(nested ? { workspaces: ['flows/*'] } : {}),
        })
      await putApp(
        'jig.ts',
        `import {defineJig,discover} from '@jigging/jig'; export default defineJig({ flows:discover('flows'),bindings:discover('bindings'), defaultProviders: { 'https://example.org/contracts/echo': 'npm:echo-method' } });`,
      )
      await putApp(
        'flows/caller/FLOW.ts',
        nested
          ? `import {marker} from 'workspace-context'; if(marker !== 'outer workspace') throw new Error('wrong workspace source');\n${caller}`
          : caller,
      )
      if (nested) {
        await putApp('flows/caller/package.json', {
          name: 'echo-caller',
          type: 'module',
          dependencies: { 'workspace-context': '0.0.0-alpha.999999' },
        })
        await put('packages/context/package.json', {
          name: 'workspace-context',
          version: '0.0.0-alpha.999999',
          type: 'module',
          exports: './index.js',
        })
        await put('packages/context/index.js', 'export const marker = "outer workspace"')
      }
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
        '--timeout',
        '120s',
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
          '--timeout',
          '120s',
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
      const cancelled = await run(
        ['run', 'npm:echo-method', '--input', '"hold"', '--timeout', '120s', '--json'],
        true,
      )
      expect(cancelled.interruptEvidence).toEqual({ sent: true })
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
      const pinned = await run([
        'run',
        'npm:echo-method',
        '--input',
        '"retained"',
        '--timeout',
        '120s',
        '--json',
      ])
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
  240_000,
)

hostTest(
  'packed read attachments preserve empty roots and maximum relative paths',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-attachment-consumer-'))
    const project = join(directory, 'project')
    const tooling = join(directory, 'tooling')
    const artifacts = join(directory, 'artifacts')
    let passed = false
    try {
      await mkdir(tooling)
      await mkdir(artifacts)
      let archive = process.env.JIG_PACKAGE_ARCHIVE
      if (!archive) {
        const packageRoot = join(import.meta.dir, '..')
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
      const put = async (path: string, value: unknown) => {
        await mkdir(dirname(join(project, path)), { recursive: true })
        await writeFile(
          join(project, path),
          typeof value === 'string' ? value : JSON.stringify(value),
        )
      }
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
          join(directory, `${++sequence}.json`),
          JSON.stringify({ args, exit, stdout, stderr }),
        )
        expect(exit, stdout + stderr).toBe(0)
        return stdout
      }
      await put('package.json', { private: true, type: 'module' })
      await put(
        'jig.ts',
        `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings')});`,
      )
      await put(
        'bindings/read.ts',
        `import {defineBinding} from '@jigging/jig';
export default defineBinding({package:'flows/read',attachments:{retained:'retained'}});`,
      )
      await put('flows/read/FLOW.contract.json', {
        $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
        attachments: { source: 'read', reference: 'read', retained: 'read' },
      })
      await put(
        'flows/read/FLOW.ts',
        `import {createInterface} from 'node:readline';
import {readdir,readFile,writeFile} from 'node:fs/promises';
for await (const line of createInterface({input:process.stdin})) {
 const request=JSON.parse(line), output={};
 for (const [name,attachment] of Object.entries(request.params.attachments)) {
  const entries=(await readdir(attachment.path)).sort();
  let writable=false;
  try {await writeFile(attachment.path+'/forbidden','x');writable=true;} catch {}
  output[name]={entries,writable};
 }
 output.contents=await Promise.all(request.params.input.map(path=>readFile(request.params.attachments.source.path+'/'+path,'utf8')));
 console.log(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{outcome:'done',output}}));
 break;
}`,
      )
      for (const name of ['source', 'reference', 'retained']) await mkdir(join(project, name))
      await invoke(['review', '--yes'])
      const run = async (paths: string[]) =>
        JSON.parse(
          await invoke([
            'run',
            'binding:read',
            '--attach',
            'source=source',
            '--attach',
            'reference=reference',
            '--input',
            JSON.stringify(paths),
            '--timeout',
            '2m',
            '--json',
          ]),
        )
      // No descriptor handoff exists in this case; every declared root must still exist.
      expect(await run([])).toMatchObject({
        status: 'succeeded',
        output: {
          source: { entries: [], writable: false },
          reference: { entries: [], writable: false },
          retained: { entries: [], writable: false },
          contents: [],
        },
      })
      const depthPath = [...Array<string>(15).fill('d'), 'file'].join('/')
      const bytePath = `${'a'.repeat(250)}/${'b'.repeat(250)}/result.txt`
      await put(`source/${depthPath}`, 'depth boundary')
      await put(`source/${bytePath}`, 'byte boundary')
      // Empty bound and per-invocation roots also coexist with nonempty input.
      expect(await run([depthPath, bytePath])).toMatchObject({
        status: 'succeeded',
        output: {
          source: { entries: ['a'.repeat(250), 'd'], writable: false },
          reference: { entries: [], writable: false },
          retained: { entries: [], writable: false },
          contents: ['depth boundary', 'byte boundary'],
        },
      })
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Attachment consumer evidence retained at ${directory}`)
    }
  },
  600000,
)

hostTest.each(['entrypoint', 'dependencies'] as const)(
  'packed project %s uses fresh reviewed data and immutable execution',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), `jig-${scenario}-consumer-`))
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
        const command = ++sequence
        const trace = join(directory, `${command}-profile.jsonl`)
        const child = Bun.spawn([installed, ...args], {
          cwd: project,
          env: {
            ...process.env,
            NO_COLOR: '1',
            ...(['review', 'run'].includes(args[0]!) ? { JIG_PRIVATE_PROFILE_FILE: trace } : {}),
          },
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
          join(directory, `${command}-${args[0]}.json`),
          JSON.stringify({ args, exit, stdout, stderr }, null, 2),
        )
        let failureEvidence = ''
        if (exit !== 0 && args[0] === 'run') {
          const phases = await readFile(trace, 'utf8')
            .then((value) =>
              value
                .trim()
                .split('\n')
                .slice(1)
                .map((line) => {
                  const event = JSON.parse(line) as {
                    kind: string
                    phase?: string
                    outcome?: string
                    timeMs?: number
                  }
                  return [event.kind, event.phase, event.outcome, event.timeMs]
                }),
            )
            .catch(() => 'unavailable')
          let lifecycle: unknown = 'unavailable'
          try {
            const database = Database.open(
              join(project, '.jig/jig.sqlite3'),
              constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
            )
            try {
              lifecycle = database
                .query(`SELECT
                  plan_digest IS NOT NULL AS planned,
                  backing_digest IS NOT NULL AS backed,
                  sandbox_digest IS NOT NULL AS sealed,
                  prepared_digest IS NOT NULL AS prepared,
                  provisional_digest IS NOT NULL AS provisional,
                  fence_digest IS NOT NULL AS fenced,
                  release_digest IS NOT NULL AS released,
                  admitted_digest IS NOT NULL AS admitted
                  FROM root_execution_lifecycles ORDER BY rowid DESC LIMIT 1`)
                .get()
            } finally {
              database.close()
            }
          } catch {
            // A failed command need not have reached durable root submission.
          }
          failureEvidence = `\nPrivate Run phases: ${JSON.stringify(phases)}\nRoot checkpoints: ${JSON.stringify(lifecycle)}`
        }
        // Inert inspect/parser paths deliberately do not open a profile or host.
        const profile =
          args[0] === 'review'
            ? (await readFile(trace, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
            : []
        return { exit, stdout, stderr, profile, failureEvidence }
      }
      const succeed = async (args: string[]) => {
        const result = await invoke(args)
        expect(result.exit, result.stdout + result.stderr + result.failureEvidence).toBe(0)
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
      if (scenario === 'entrypoint') {
        await put('package.json', { private: true, type: 'module' })
        await put('flows/echo/FLOW.ts', echo)
        await put('flows/files/FLOW.ts', echo)
        await put(
          'flows/crash/FLOW.ts',
          "console.error('fixture: installed Flow deliberately raising SIGSEGV'); process.kill(process.pid, 'SIGSEGV');",
        )
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
        const crashStarted = performance.now()
        const crashed = await invoke(['run', 'flow:flows/crash', '--timeout', '30s', '--json'])
        expect(performance.now() - crashStarted).toBeLessThan(20_000)
        expect(crashed.exit).toBe(1)
        const crashTerminal = JSON.parse(crashed.stdout)
        expect(crashTerminal.status).toBe('failed')
        // Fast natural signal exit can close Run/0 before crash polling observes
        // it. Both are honest failures; neither should consume the Run deadline.
        expect(['EXECUTION_FAILED', 'CHANNEL_LOST']).toContain(crashTerminal.code)
        // A following ordinary Run remains usable after the failed invocation.
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
        return
      }

      // A real installed consumer edits project source without a new install.
      // These are local Bun workspace inputs, not registry/model calls.
      await put('jig.ts', declaration('binding:dependencies'))
      await put('package.json', {
        private: true,
        type: 'module',
        workspaces: ['flows/dependencies', 'libs/*'],
      })
      await put('libs/helper/package.json', {
        name: 'helper',
        type: 'module',
        exports: './index.ts',
      })
      await put('libs/helper/index.ts', 'export const value = 1;')
      await put('libs/helper/removed.txt', 'original resource')
      await put('flows/dependencies/package.json', {
        name: 'dependencies',
        type: 'module',
        dependencies: { helper: 'workspace:*' },
      })
      await put(
        'flows/dependencies/FLOW.ts',
        `import {value} from 'helper';\n${echo.replace('let output=input;', 'let output={input,value,settings:request.params.settings};')}`,
      )
      await put('flows/dependencies/settings.schema.json', {
        $schema: 'https://flow.jig.md/schemas/schema-0.json',
        type: 'object',
        properties: { phase: { type: 'string' } },
        additionalProperties: false,
      })
      const binding = (phase: string) =>
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/dependencies',settings:{phase:${JSON.stringify(phase)}}});`
      await put('bindings/dependencies.ts', binding('first'))
      const count = (result: Awaited<ReturnType<typeof invoke>>, phase: string) =>
        result.profile.filter(
          (record) =>
            record.phase === phase && (record.kind === 'start' || record.kind === 'instant'),
        ).length
      const prepared = await succeed(['review', '--yes', '--allow-resolution-network'])
      expect(count(prepared, 'dependency-preparation')).toBe(1)
      const runDependency = async () =>
        JSON.parse(
          (await succeed(['run', 'binding:dependencies', '--input', '"checked"', '--json'])).stdout,
        )
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { input: 'checked', value: 1, settings: { phase: 'first' } },
      })
      const unchanged = await succeed(['review', '--yes'])
      expect(count(unchanged, 'dependency-preparation')).toBe(0)
      expect(count(unchanged, 'dependency-reuse')).toBe(1)
      await put('libs/helper/index.ts', 'export const value = 2;')
      await rm(join(project, 'libs/helper/removed.txt'))
      await put('libs/helper/added.txt', 'new resource')
      // Until review, execution still uses the old admitted source.
      expect(await runDependency()).toMatchObject({ output: { value: 1 } })
      const edited = await succeed(['review', '--yes'])
      expect(count(edited, 'dependency-preparation')).toBe(0)
      expect(count(edited, 'dependency-reuse')).toBe(1)
      expect(edited.stdout).toContain('Prepared execution files or dependency layout changed')
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'first' } },
      })
      await put('bindings/dependencies.ts', binding('second'))
      const settingsChanged = await succeed(['review', '--yes'])
      expect(count(settingsChanged, 'dependency-preparation')).toBe(0)
      expect(count(settingsChanged, 'dependency-reuse')).toBe(1)
      expect(await runDependency()).toMatchObject({
        output: { value: 2, settings: { phase: 'second' } },
      })
      // Five independent Bindings still perform bootstrap and complete-closure
      // evaluation. Only their envelope setup is shared; public Run uses each
      // declaration's freshly checked settings, not an evaluated-value cache.
      for (let index = 0; index < 4; index += 1)
        await put(`bindings/peer${index}.ts`, binding(`peer-${index}`))
      const manyBindings = await succeed(['review', '--yes'])
      expect(count(manyBindings, 'author-envelope-startup')).toBe(2)
      expect(count(manyBindings, 'dependency-preparation')).toBe(0)
      expect(count(manyBindings, 'dependency-reuse')).toBe(1)
      const peer = JSON.parse(
        (await succeed(['run', 'binding:peer3', '--input', '"checked"', '--json'])).stdout,
      )
      expect(peer).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'peer-3' } },
      })
      await put('bindings/bad.ts', 'throw new Error("inert fixture failure"); export default {};')
      const refused = await invoke(['review', '--yes'])
      expect(refused.exit).not.toBe(0)
      expect(refused.stderr).toContain('bindings/bad.ts')
      expect(await runDependency()).toMatchObject({
        output: { value: 2, settings: { phase: 'second' } },
      })
      await rm(join(project, 'bindings/bad.ts'))
      await put('libs/helper/package.json', {
        name: 'helper',
        type: 'module',
        exports: './index.ts',
        description: 'Changed installer input',
      })
      const missingPermission = await invoke(['review', '--yes'])
      expect(missingPermission.exit).not.toBe(0)
      expect(missingPermission.stderr).toContain('PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED')
      const dependencyChanged = await succeed(['review', '--yes', '--allow-resolution-network'])
      expect(count(dependencyChanged, 'dependency-preparation')).toBe(1)
      expect(count(dependencyChanged, 'dependency-reuse')).toBe(0)
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'second' } },
      })
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Packed ${scenario} consumer evidence retained at ${directory}`)
    }
  },
  600000,
)

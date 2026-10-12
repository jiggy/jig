import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

const testRoot = join(import.meta.dir, '..')

test('packed read attachments preserve empty roots and maximum relative paths', async () => {
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
      const packageRoot = join(testRoot, '..')
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
}, 600000)

import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { flowSdkRuntimeDirectory } from '../fixtures/flow-dependency.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'

const { TRIAL_JAVA, TRIAL_CHROME, TRIAL_FONTS, TRIAL_EPUBCHECK, TRIAL_FONTCONFIG } = process.env
if (![TRIAL_JAVA, TRIAL_CHROME, TRIAL_FONTS, TRIAL_EPUBCHECK, TRIAL_FONTCONFIG].every(Boolean))
  throw new Error('Install the pinned runtimes before running the preview trial')

const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

test('a reviewed Flow validates and renders one exact EPUB offline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-epub-preview-'))
  const cli = join(installedBunLocation.releaseRoot, 'bin', 'jig')
  const invoke = async (...args: string[]) => {
    const child = Bun.spawn([cli, ...args], { cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, stdout + stderr).toBe(0)
    return stdout
  }
  const put = async (path: string, content: string | object) => {
    const target = join(root, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, typeof content === 'string' ? content : JSON.stringify(content))
  }
  let passed = false
  try {
    const fixture = Bun.spawnSync([
      'python3', join(import.meta.dir, 'offline-tool-epub-fixture.py'), join(root, 'edition'),
    ])
    expect(fixture.exitCode, fixture.stderr.toString()).toBe(0)
    await put('jig.ts', `import {defineJig,discover} from '@jigging/jig'
export default defineJig({flows:discover('flows'),bindings:discover('bindings')})`)
    await put('flows/inspect/FLOW.meta.json', {
      name: 'inspect', description: 'Validate and render an EPUB using reviewed offline tools.',
      uses: { check: { contract: './contracts/tool/contract.json' }, render: { contract: './contracts/tool/contract.json' } },
    })
    await put('flows/inspect/FLOW.contract.json', {
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      attachments: { source: 'read' }, artifactResults: ['report', 'preview'],
    })
    await put('flows/inspect/FLOW.ts', `import {handle,OperationError} from './sdk/index.js'
await handle(async run => {
  const attachments = {source:{read:run.attachments.source.artifact},deliverables:{create:true}};
  const output = {}, artifactResults = {};
  for (const [slot, result] of [['check', 'report'], ['render', 'preview']]) {
    try {
      const called = await run.call({operationId:slot,slot,input:{},attachments});
      output[slot] = called.output;
      artifactResults[result] = called.artifacts.deliverables;
    } catch (error) {
      if (!(error instanceof OperationError)) throw error;
      output[slot] = {code:error.code,message:error.message,...(error.details===undefined?{}:{details:error.details})};
    }
  }
  return {outcome:'done',output,artifactResults};
});`)
    await cp(flowSdkRuntimeDirectory, join(root, 'flows/inspect/sdk'), { recursive: true })
    await mkdir(join(root, 'flows/inspect/contracts'))
    await invoke('import-contract', 'jig:offline-tool', 'flows/inspect/contracts/tool')
    const slots = {
      check: {
        kind: 'tool', executable: `${TRIAL_JAVA}/bin/java`, runtimeRoots: [TRIAL_JAVA, TRIAL_EPUBCHECK],
        args: ['-jar', `${TRIAL_EPUBCHECK}/epubcheck.jar`, '/jig-input/source/book.epub', '--json', '/jig-output/check.json'],
        exitCodes: [0, 1],
      },
      render: {
        kind: 'tool', executable: `${TRIAL_CHROME}/chrome-headless-shell-linux64/chrome-headless-shell`,
        runtimeRoots: [TRIAL_CHROME, TRIAL_FONTS, TRIAL_FONTCONFIG], environment: { FONTCONFIG_FILE: TRIAL_FONTCONFIG },
        args: ['--disable-gpu', '--disable-background-networking', '--disable-dev-shm-usage', '--user-data-dir=/tmp/chrome', '--window-size=390,800', '--screenshot=/jig-output/page.png', 'file:///jig-input/source/chapter.xhtml'],
        nestedUserNamespaces: true,
      },
    }
    await put('bindings/inspect.ts', `import {defineBinding} from '@jigging/jig'
export default defineBinding({package:'flows/inspect',slots:${JSON.stringify(slots)}})`)
    await invoke('review', '--yes', '--allow-authority-changes')
    const packet = JSON.parse(await invoke('run', 'binding:inspect', '--attach', 'source=edition', '--out', 'packet', '--timeout', '3m', '--json'))
    const names = ['book.epub', 'chapter.xhtml', 'cover.png']
    const inputFiles = await Promise.all(names.map(async (path) => {
      const bytes = await readFile(join(root, 'edition', path))
      return { path, bytes: bytes.length, digest: digest(bytes) }
    }))
    expect(packet.output.check).toMatchObject({ exitCode: 0, cleanup: 'complete', inputFiles })
    expect(packet.output.render).toMatchObject({ exitCode: 0, cleanup: 'complete', inputFiles })
    const report = await readFile(join(root, 'packet/files/report/check.json'))
    expect(JSON.parse(report.toString()).checker).toMatchObject({ checkerVersion: '5.4.0', nFatal: 0, nError: 0, nWarning: 0 })
    const png = await readFile(join(root, 'packet/files/preview/page.png'))
    expect(png.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([390, 800])
    expect(packet.delivery.files).toEqual([
      { path: 'preview/page.png', bytes: png.length, digest: digest(png) },
      { path: 'report/check.json', bytes: report.length, digest: digest(report) },
    ])
    console.log(JSON.stringify({ epub: inputFiles[0], report: { bytes: report.length, sha256: digest(report) }, preview: { width: 390, height: 800, bytes: png.length, sha256: digest(png) } }))
    passed = true
  } finally {
    if (passed) await rm(root, { recursive: true, force: true })
    else console.error(`EPUB trial evidence retained at ${root}`)
  }
}, 220_000)

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const temporary = await mkdtemp(join(tmpdir(), 'display-web-consumer-'))
const packageRoot = resolve(import.meta.dir, '..')
const candidates = new Map<string, string>()
const supplied = (name: string): string => {
  const path = process.env[name]
  assert(path && isAbsolute(path), `Set ${name} to the exact absolute candidate archive`)
  candidates.set(name, path)
  return `file:${path}`
}
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: temporary, stdout: 'pipe', stderr: 'pipe' })
  const readers = [child.stdout.getReader(), child.stderr.getReader()]
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Consumer command timed out: ${args.join(' ')}`))
    }, 120000)
  })
  const bounded = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    while (true) {
      const item = await reader.read()
      if (item.done) return text + decoder.decode()
      bytes += item.value.byteLength
      if (bytes > 1024 * 1024) {
        child.kill('SIGKILL')
        throw new Error('Consumer diagnostic output exceeded 1 MiB')
      }
      text += decoder.decode(item.value, { stream: true })
    }
  }
  try {
    const [code, stdout, stderr] = await Promise.race([
      Promise.all([child.exited, bounded(readers[0]!), bounded(readers[1]!)]),
      deadline,
    ])
    assert.equal(code, 0, `${args.join(' ')}\n${stdout}\n${stderr}`)
  } finally {
    clearTimeout(timeout)
    if (child.exitCode === null) child.kill('SIGKILL')
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
    for (const reader of readers) reader.releaseLock()
    await child.exited
  }
}
const hashes = async () =>
  new Map(
    await Promise.all(
      [...candidates].map(
        async ([name, path]) =>
          [
            name,
            createHash('sha256')
              .update(await readFile(path))
              .digest('hex'),
          ] as const,
      ),
    ),
  )
async function files(directory: string): Promise<string[]> {
  const values: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) values.push(...(await files(path)))
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) values.push(path)
  }
  return values
}
let before: Map<string, string> | undefined
try {
  const node = process.env.FLOW_NODE
  assert(node && isAbsolute(node), 'Set FLOW_NODE to an absolute independent Node executable')
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@jigging/display-model': supplied('DISPLAY_MODEL_PACKAGE_ARCHIVE'),
        '@jigging/user-updates': supplied('USER_UPDATES_PACKAGE_ARCHIVE'),
        '@jigging/flow': supplied('FLOW_SDK_PACKAGE_ARCHIVE'),
        '@jigging/display-web': supplied('DISPLAY_WEB_PACKAGE_ARCHIVE'),
      },
    }),
  )
  before = await hashes()
  await run([
    'npm',
    'install',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
    '--cache',
    join(temporary, 'cache'),
  ])
  for (const name of ['jig', 'display-tui'])
    await assert.rejects(access(join(temporary, 'node_modules/@jigging', name)))
  await assert.rejects(access(join(temporary, 'node_modules/@opentui')))
  const installed = join(temporary, 'node_modules/@jigging/display-web')
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.0-alpha.1')
  assert.equal(manifest.scripts, undefined)
  await assert.rejects(access(join(installed, 'src')))
  for (const path of await files(join(installed, 'dist'))) {
    const source = await readFile(path, 'utf8')
    assert(
      !/@jigging\/jig|@jigging\/display-tui|@opentui|cli-run-model|cli-web-snapshot/.test(source),
      path,
    )
  }
  for (const name of ['LICENSE.md', 'PRICING.md', 'LICENSES.md'])
    assert.deepEqual(
      await readFile(join(installed, name)),
      await readFile(join(packageRoot, '../../', name)),
    )
  await writeFile(
    join(temporary, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
import { validateDisplaySnapshot, callObservationSpans, displayDestinations, displayViewKey, recordReferences } from '@jigging/display-model';
const supplied = {
    kind: 'snapshot', revision: 1, mode: 'live-run', rootSourceId: 'source-root',
    workspace: { target: 'Review supplied evidence', phase: 'settled', hostStage: 'Done', elapsedMs: 10,
      facts: {
        execution: { value: 'succeeded', provenance: 'host-observed' },
        application: { value: 'needs-review', provenance: 'application-reported' },
        cleanup: { value: 'complete', provenance: 'host-observed' },
        delivery: { value: 'written', provenance: 'host-observed' },
        completeness: { value: 'observation ended', provenance: 'host-observed' },
      } },
    context: 'Reports are literal application claims',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [{ id: 'view-root', sourceId: 'source-root', sourceLabel: 'Root method', updatedAt: 10,
      value: { kind: 'view', id: 'findings', title: 'Findings', summary: 'Supplied report',
        sections: [{ blocks: [{ kind: 'collection', id: 'records', title: 'Records',
          columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'evidence', label: 'Evidence', type: 'reference' }],
          rows: [{ id: 'one', cells: { name: 'Finding', evidence: { kind: 'artifact', attachment: 'output', path: 'notes.txt' } },
            details: [{ kind: 'report', text: 'Requires independent review' }] }] }] }] } }],
    calls: [{ id: 'call-root', sourceId: 'source-root', sourceLabel: 'Root method', operationId: 'worker',
      childSourceId: 'source-child', slot: 'check', state: 'uncertain', firstObservedAt: 1, observedAt: 10,
      cause: 'No confirmed answer' }],
    activities: [], journal: [],
    attention: [{ id: 'cause', attribution: { provenance: 'host-observed', sourceLabel: 'Host', callId: 'call-root' },
      priority: 4, text: 'No confirmed answer', transcriptCommitted: false }],
    artifacts: { generation: 'capture-one', sourceId: 'source-root', permittedAttachments: ['output'],
      provenance: 'verified-delivery', phase: 'ready',
      files: [{ id: 'artifact-one', path: 'notes.txt', bytes: 12, state: 'text', clipped: false }] },
  };
const snapshot = validateDisplaySnapshot(supplied);
assert.equal(snapshot.calls[0].state, 'uncertain');
assert.equal(snapshot.workspace.facts.application.provenance, 'application-reported');
assert.equal(snapshot.attention[0].transcriptCommitted,false);
assert(Object.isFrozen(snapshot.views[0].value.sections));
assert.equal(callObservationSpans(snapshot.calls).spans.get('call-root').milliseconds,9);
assert.throws(() => validateDisplaySnapshot({...supplied,rootSourceId:undefined}),TypeError);
assert.equal(recordReferences({row:snapshot.views[0].value.sections[0].blocks[0].rows[0]}).length,1);

const opaqueIds = ['files', 'overview', 'activity', displayViewKey('files')];
const colliding = validateDisplaySnapshot({...supplied,views:opaqueIds.map((id,index) => ({...supplied.views[0],id,value:{...supplied.views[0].value,id:'semantic-'+index}}))});
const destinations = displayDestinations(false,colliding.views.map(view => ({key:view.id,title:view.value.title,source:view.sourceLabel})));
assert.equal(new Set(destinations.map(destination=>destination.key)).size,destinations.length);
assert.deepEqual(destinations.slice(0,3).map(destination=>destination.key),['overview','activity','files']);
assert.deepEqual(destinations.slice(3).map(destination=>destination.key),opaqueIds.map(displayViewKey));
assert.deepEqual(colliding.views.map(view=>view.id),opaqueIds);

import { browserRecords, browserLocal, browserPeek, browserResolve, browserCallSpans, browserTabs, browserView, BrowserClient } from '@jigging/display-web';
import { webAssets } from '@jigging/display-web/assets';
const collisionTabs = browserTabs(colliding);
assert.equal(new Set(collisionTabs.map(tab=>tab.id)).size,collisionTabs.length);
for(const key of ['files','overview','activity']) assert.equal(browserView(colliding,key),undefined);
for(const [index,id] of opaqueIds.entries()) {
  const selected=browserView(colliding,displayViewKey(id));
  assert.equal(selected.id,id);
  assert.equal(browserRecords(selected,browserLocal())[1].row.details[0].text,'Requires independent review');
  const target=browserResolve(colliding,colliding.rootSourceId,{kind:'record',viewId:'semantic-'+index,collectionId:'records',rowId:'one'});
  assert.equal(target.kind,'record');assert.equal(target.viewId,id);
  assert.equal(browserView(colliding,displayViewKey(target.viewId)),selected);
}
const records = browserRecords(snapshot.views[0], browserLocal());
assert.equal(records[1].row.details[0].text, 'Requires independent review');
const reference = browserPeek(records[1]);
assert.deepEqual(browserResolve(snapshot, snapshot.rootSourceId, reference), { kind:'artifact', label:'notes.txt', artifactId:'artifact-one', captureGeneration:'capture-one' });
assert.equal(browserResolve(snapshot, 'other-source', reference).kind, 'unavailable');
assert.equal(browserCallSpans(snapshot.calls).spans.get('call-root').milliseconds, 9);
assert.deepEqual(Object.keys(webAssets), ['/', '/assets/app.js', '/assets/app.css']);
assert(!/node:|@opentui\\/|\\bfrom\\s*["']|\\bimport\\s*["']|\\beval\\(/.test(webAssets['/assets/app.js'].body));
assert(!/@import|url\\(/.test(webAssets['/assets/app.css'].body));
assert(!/localStorage|sessionStorage|EventSource/.test(webAssets['/assets/app.js'].body));
let current = snapshot, text = 'Captured text', reads = 0;
const client = new BrowserClient('a'.repeat(43), () => {}, { fetch: async (path, init) => {
  if (path === '/api/events') return new Response(new ReadableStream({start(controller) {init.signal.addEventListener('abort', () => controller.close(), {once:true});}}));
  if (path === '/api/snapshot') return new Response(JSON.stringify(current));
  if (path === '/api/artifacts/artifact-one/preview') { reads++; return new Response(JSON.stringify({artifactId:'artifact-one',captureGeneration:'capture-one',provenance:'verified-delivery',state:'text',text,bytes:13,clipped:false})); }
  throw new Error('Unexpected route');
}});
client.start();
for(let i=0;i<100 && !client.body;i++) await new Promise(resolve => setTimeout(resolve,0));
assert.equal(client.body.calls[0].state, 'uncertain');
client.setPreview({artifactId:'artifact-one',captureGeneration:'capture-one',signature:'selected'});
for(let i=0;i<100 && client.preview?.phase==='loading';i++) await new Promise(resolve => setTimeout(resolve,0));
assert.equal(client.preview.reply.text, text);assert.equal(reads,1);
client.stop();assert.equal(client.referencesEnabled,false);assert.equal(client.preview,undefined);
`,
  )
  await run([process.execPath, 'consumer.mjs'])
  await run([
    node,
    '-e',
    'if (process.release.name !== "node" || process.versions.bun) process.exit(70)',
  ])
  await run([node, 'consumer.mjs'])
  await writeFile(
    join(temporary, 'consumer.ts'),
    `
import { validateDisplaySnapshot, displayViewKey, recordReferences, type DisplaySnapshot, type DisplaySnapshotEnvelope } from '@jigging/display-model';
export const data: DisplaySnapshotEnvelope = validateDisplaySnapshot({});
export const destination: string = displayViewKey('files');
export function references(snapshot: DisplaySnapshot) {
  for (const view of snapshot.views) for (const section of view.value.sections)
    for (const block of section.blocks) if (block.kind === 'collection')
      return recordReferences({ row: block.rows[0] });
  return [];
}
import { browserRecords, browserLocal, browserView } from '@jigging/display-web';
import { webAssets } from '@jigging/display-web/assets';
export const content = webAssets['/']?.body;
export function selected(snapshot: DisplaySnapshot) { return browserView(snapshot, destination) }
export function records() { return data.kind === 'snapshot' && data.views[0] ? browserRecords(data.views[0],browserLocal()) : [] }
`,
  )
  await run([
    process.execPath,
    join(packageRoot, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--lib',
    'ES2022,DOM',
    'consumer.ts',
  ])
  console.log('Packed display-web public semantic consumer passed without Jig or native support.')
} finally {
  try {
    if (before)
      assert.deepEqual(
        await hashes(),
        before,
        'Candidate archive bytes changed during qualification',
      )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

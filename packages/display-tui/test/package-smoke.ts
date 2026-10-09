import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const temporary = await mkdtemp(join(tmpdir(), 'display-tui-consumer-'))
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
  await run([
    node,
    '-e',
    'if (process.release.name !== "node" || process.versions.bun) process.exit(70)',
  ])
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@jigging/display-model': supplied('DISPLAY_MODEL_PACKAGE_ARCHIVE'),
        '@jigging/user-updates': supplied('USER_UPDATES_PACKAGE_ARCHIVE'),
        '@jigging/flow': supplied('FLOW_SDK_PACKAGE_ARCHIVE'),
        '@jigging/display-tui': supplied('DISPLAY_TUI_PACKAGE_ARCHIVE'),
      },
    }),
  )
  before = await hashes()
  await run([
    'npm',
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    join(temporary, 'cache'),
  ])
  for (const name of ['jig', 'display-web'])
    await assert.rejects(access(join(temporary, 'node_modules/@jigging', name)))
  const installed = join(temporary, 'node_modules/@jigging/display-tui')
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.0-alpha.1')
  assert.equal(manifest.scripts, undefined)
  await assert.rejects(access(join(installed, 'src')))
  for (const path of await files(join(installed, 'dist'))) {
    const source = await readFile(path, 'utf8')
    assert(!/@jigging\/jig|@jigging\/display-web|cli-run-model|cli-web-snapshot/.test(source), path)
  }
  for (const name of ['index.d.ts', 'types.d.ts', 'inline.d.ts', 'text.d.ts', 'style.d.ts'])
    assert(
      !/@opentui|CliRenderer|OptimizedBuffer|NativeRenderer|ViewerModel/.test(
        await readFile(join(installed, 'dist', name), 'utf8'),
      ),
      name,
    )
  for (const name of ['LICENSE.md', 'PRICING.md', 'LICENSES.md'])
    assert.deepEqual(
      await readFile(join(installed, name)),
      await readFile(join(packageRoot, '../../', name)),
    )
  await writeFile(
    join(temporary, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
const raw = process.stdin.isRaw, listeners = process.stdin.listenerCount('data');
const { createInlineDisplay } = await import('@jigging/display-tui/inline');
const { escapeTerminalText, terminalWidth } = await import('@jigging/display-tui/text');
const { heading, syntaxHex } = await import('@jigging/display-tui/style');
const { prepareTui, createTui, TuiSupportError } = await import('@jigging/display-tui');
const value = {
  kind:'snapshot',revision:1,mode:'live-run',rootSourceId:'consumer-source',
  workspace:{target:'Independent packet review',phase:'live',hostStage:'Inspecting',elapsedMs:100},
  context:'Supplied reports are literal claims',
  omissions:{calls:0,journal:{flow:0,host:0,diagnostic:0}},calls:[],activities:[],journal:[],attention:[],
  views:[{id:'independent-view',sourceId:'consumer-source',sourceLabel:'Consumer method',updatedAt:100,
    value:{kind:'view',id:'evidence',title:'Supplied evidence',landing:true,summary:'Review retained claims',
      sections:[{blocks:[{kind:'collection',id:'documents',title:'Documents',columns:[{key:'name',label:'Name',type:'text'},{key:'file',label:'Evidence',type:'reference'}],
        rows:[{id:'row-one',cells:{name:'CASE-17',file:{kind:'artifact',attachment:'output',path:'report.txt'}},details:[{kind:'report',text:'Keep the supplied concern visible'}]}]}]}]}}],
  artifacts:{generation:'consumer-capture',sourceId:'consumer-source',provenance:'verified-delivery',phase:'ready',permittedAttachments:['output'],
    files:[{id:'artifact-consumer',path:'report.txt',bytes:14,state:'text',clipped:false}]},
};
const reservedIds=['files','overview','activity',JSON.stringify(['view','files'])];
for(const [index,id] of reservedIds.entries()) value.views.push({id,sourceId:value.rootSourceId,sourceLabel:'Consumer method',updatedAt:100,value:{kind:'view',id:'portable-'+index,title:'Reserved application '+index,summary:'Reserved literal '+index,sections:[]}});
const inline = createInlineDisplay({snapshot:value});
assert(inline.frame({columns:100,rows:16,color:false}).lines.join('\\n').includes('CASE-17'));
assert.equal(terminalWidth('A界'),3);
assert.equal(escapeTerminalText(String.fromCharCode(27)+'[31m'),String.fromCharCode(92)+'u001b[31m');
assert.equal(heading('Plain','info',false),'Plain');assert.match(syntaxHex('string','one-light'),/^[0-9a-f]{6}$/i);
assert.equal(process.stdin.isRaw,raw);assert.equal(process.stdin.listenerCount('data'),listeners);
await assert.rejects(createTui({}, {snapshot:value}), TuiSupportError);
let changes=0,reads=0; const actions=[];
const display = await createTui(await prepareTui(), {snapshot:value,theme:'one-light',
  onChange:()=>changes++,onAction:action=>actions.push(action),preview:async intent=>{
    reads++;assert.deepEqual(intent,{artifactId:'artifact-consumer',captureGeneration:'consumer-capture'});
    return {...intent,provenance:'verified-delivery',state:'text',text:'Frozen excerpt',bytes:14,clipped:false};
  }});
try {
  display.update({...value,workspace:{...value.workspace,elapsedMs:110}});assert.equal(changes,0);
  const viewport={columns:140,rows:36,color:false};
  const first=display.frame(viewport);assert.equal(display.frame(viewport),first);
  assert((await first).text.includes('Supplied evidence'));
  display.input(new TextEncoder().encode('c'));
  await display.frame(viewport);
  for(let i=0;i<10 && !reads;i++) await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(reads,1);
  const preview=await display.frame({...viewport,color:true});assert(preview.text.includes('Frozen excerpt'));
  assert(Buffer.byteLength(preview.text)<=32768);
  display.input(new TextEncoder().encode('v'+String.fromCharCode(27)+'[Hjj'+String.fromCharCode(13)));
  assert((await display.frame(viewport)).text.includes('report.txt'));
  display.input(new TextEncoder().encode(String.fromCharCode(9)));
  for(let index=0;index<reservedIds.length;index++) {
    display.input(new TextEncoder().encode(String.fromCharCode(9)));
    assert((await display.frame(viewport)).text.includes('Reserved literal '+index));
  }
  display.input(new TextEncoder().encode('q'));assert.deepEqual(actions,['close']);
  const transferred=display.handoffInline();assert(transferred);display.dispose();
  assert(transferred.frame({columns:100,rows:16,color:false}).lines.join(String.fromCharCode(10)).includes('Reserved literal 3'));
  transferred.dispose();assert.equal(display.handoffInline(),undefined);
  assert.equal(value.workspace.phase,'live');
} finally {display.dispose();inline.dispose();}
assert.deepEqual(await display.frame({columns:80,rows:24,color:false}),{text:''});
assert.equal(process.stdin.isRaw,raw);assert.equal(process.stdin.listenerCount('data'),listeners);
const facts={...value,views:[],workspace:{...value.workspace,phase:'settled',facts:{
  execution:{value:'succeeded',provenance:'application-reported',clipped:true},
  application:{value:'succeeded',provenance:'application-reported'},
  cleanup:{value:'complete',provenance:'recorded-claim'},
  delivery:{value:'written',provenance:'host-observed',clipped:true}}}};
const factsInline=createInlineDisplay({snapshot:facts});
const factsTui=await createTui(await prepareTui(),{snapshot:facts,theme:'one-light'});
try {
  const native=(await factsTui.frame({columns:200,rows:28,color:true})).text;
  assert(native.includes('Reported execution [clipped] succeeded'));
  assert(native.includes('Recorded cleanup complete'));
  assert(!native.includes('38;2;50;101;45'));
  const warning='Unavailable'+String.fromCharCode(27)+'[777A'+String.fromCharCode(10)+'Additional reason';
  factsInline.update({...facts,revision:2,incomplete:warning});
  for(const viewport of [{columns:160,rows:12,color:false},{columns:18,rows:4,color:false}]) {
    const frame=factsInline.frame(viewport);
    assert(frame.lines.length<=viewport.rows);assert(Buffer.byteLength(frame.lines.join(String.fromCharCode(10)))<=32768);
    assert(frame.lines.some(line=>line.includes('Incomplete')));
    for(const line of frame.lines) {assert(!line.includes(String.fromCharCode(27)));assert(!line.includes(String.fromCharCode(10)));assert(terminalWidth(line)<viewport.columns);}
  }
} finally {factsTui.dispose();factsInline.dispose();}
`,
  )
  await run([process.execPath, 'consumer.mjs'])
  await writeFile(
    join(temporary, 'missing-support.mjs'),
    `
import assert from 'node:assert/strict';
import { createInlineDisplay } from '@jigging/display-tui/inline';
import { escapeTerminalText } from '@jigging/display-tui/text';
import { prepareTui, TuiSupportError } from '@jigging/display-tui';
const value={kind:'snapshot',revision:1,mode:'live-run',rootSourceId:'root',workspace:{target:'Independent',phase:'live',hostStage:'Waiting',elapsedMs:0},context:'Current observations',omissions:{calls:0,journal:{flow:0,host:0,diagnostic:0}},views:[],calls:[],activities:[],journal:[],attention:[],artifacts:{generation:'capture',sourceId:'root',permittedAttachments:[],provenance:'verified-delivery',phase:'ready',files:[]}};
const display=createInlineDisplay({snapshot:value});assert(display.frame({columns:80,rows:12,color:false}).lines.length>0);display.dispose();
assert.equal(escapeTerminalText('safe'),'safe');await assert.rejects(prepareTui(),TuiSupportError);
`,
  )
  const core = join(temporary, 'node_modules/@opentui/core')
  const hidden = join(temporary, 'native-support-hidden')
  await rename(core, hidden)
  try {
    await run([process.execPath, 'missing-support.mjs'])
  } finally {
    await rename(hidden, core)
  }
  await writeFile(
    join(temporary, 'consumer.ts'),
    `
import { prepareTui, createTui, type TuiDisplay, type TuiSupport, type TuiViewport } from '@jigging/display-tui';
import { createInlineDisplay } from '@jigging/display-tui/inline';
import { escapeTerminalText } from '@jigging/display-tui/text';
import { syntaxHex } from '@jigging/display-tui/style';
import type { DisplaySnapshotEnvelope } from '@jigging/display-model';
export async function inspect(snapshot: DisplaySnapshotEnvelope): Promise<TuiDisplay> {
  const support: TuiSupport = await prepareTui();
  const display = await createTui(support,{snapshot,onAction: action => { const intent: 'close'|'interrupt' = action; return intent; }});
  display.update(snapshot);display.input(new Uint8Array());
  const viewport: TuiViewport = {columns:80,rows:24,color:false};
  const frame: {text:string} = await display.frame(viewport);
  const inline: {lines:string[]} = createInlineDisplay({snapshot}).frame(viewport);
  const transferred = display.handoffInline();
  transferred?.frame(viewport);transferred?.dispose();
  escapeTerminalText(frame.text);syntaxHex('string','one-dark');return display;
}
`,
  )
  await run([
    node,
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
  console.log(
    'Packed display-tui public semantic/native consumer passed without Jig or another renderer.',
  )
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

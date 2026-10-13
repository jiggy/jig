import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runSourceLanes } from './source-lanes.mjs'

const owner = fileURLToPath(new URL('./source-lanes.mjs', import.meta.url))
const sourceScript = fileURLToPath(new URL('../test-release.sh', import.meta.url))
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(check) {
  const deadline = Date.now() + 8000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'fixture readiness deadline')
    await delay(10)
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}
function launch(command, args, env, cwd) {
  const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (bytes) => {
    output += bytes
  })
  child.stderr.on('data', (bytes) => {
    output += bytes
  })
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, output }))
  })
  return { child, done }
}
function executable(path, body) {
  writeFileSync(path, body, { mode: 0o700 })
  return path
}

function fixture(t, mode, ambient = false) {
  const root = mkdtempSync(join(tmpdir(), 'jig-source-lanes-'))
  const directory = join(root, 'lanes')
  mkdirSync(directory)
  const childFile = join(root, 'lane.mjs')
  writeFileSync(
    childFile,
    `
import{spawn}from'node:child_process';import{existsSync,writeFileSync}from'node:fs';import{join}from'node:path';
const root=process.env.FIXTURE_ROOT,lane=process.argv[2],mode=process.env.FIXTURE_MODE;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
writeFileSync(join(root,lane+'.started'),String(process.pid));console.log(lane+' started');
if(mode==='barrier') { while(!existsSync(join(root,(lane==='portable'?'other':'portable')+'.started')))await pause(10) }
if(mode==='failure'&&lane==='portable')process.exit(7);
if(mode==='cancel'||(mode==='orphan'&&lane==='portable')) {
  process.on('SIGTERM',()=>{});
  const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",join(root,lane+'.descendant')],{stdio:'ignore'});
  while(!existsSync(join(root,lane+'.descendant')))await pause(10);
  if(mode==='orphan')process.exit(0);
  setInterval(()=>{},1000);await new Promise(()=>{});
}
if(lane==='other')await pause(75);
writeFileSync(join(root,lane+'.done'),'done');console.log(lane+' completed');
`,
  )
  const loader = join(root, 'owner.mjs')
  writeFileSync(
    loader,
    `import{runSourceLanes}from ${JSON.stringify(new URL('./source-lanes.mjs', import.meta.url).href)};try{process.exitCode=(await runSourceLanes({directory:process.env.LANE_DIRECTORY,platform:'linux'})).exitCode}catch(error){console.error(error.message);process.exitCode=1}`,
  )
  const script = executable(
    join(root, 'launch.sh'),
    `#!/bin/bash
set -eu
source_portable_lane() { "$FLOW_NODE" "$FIXTURE_CHILD" portable; }
source_other_lane() { "$FLOW_NODE" "$FIXTURE_CHILD" other; }
export -f source_portable_lane source_other_lane
if [ -n "\${FIXTURE_BASH_ENV:-}" ]; then export BASH_ENV="$FIXTURE_BASH_ENV"; fi
exec "$FLOW_NODE" "$FIXTURE_OWNER"
`,
  )
  if (ambient)
    executable(
      join(root, 'ambient.sh'),
      'printf "ambient injection\\n"; touch "$FIXTURE_ROOT/ambient-ran"\n',
    )
  const env = {
    ...process.env,
    FIXTURE_BASH_ENV: ambient ? join(root, 'ambient.sh') : '',
    GITHUB_ACTIONS: 'true',
    JIG_CI_SOURCE_PARALLEL: '1',
    source_targets: 'source-portable,source-protocol',
    FLOW_NODE: process.execPath,
    FIXTURE_ROOT: root,
    FIXTURE_CHILD: childFile,
    FIXTURE_OWNER: loader,
    FIXTURE_MODE: mode,
    LANE_DIRECTORY: directory,
  }
  delete env.BASH_ENV
  const running = launch('/bin/bash', [script], env, root)
  t.after(async () => {
    if (running.child.exitCode === null) {
      running.child.kill('SIGTERM')
      await running.done
    }
    for (const lane of ['portable', 'other']) {
      const path = join(root, `${lane}.descendant`)
      if (existsSync(path)) {
        try {
          process.kill(Number(readFileSync(path, 'utf8')), 'SIGKILL')
        } catch {}
      }
    }
    rmSync(root, { recursive: true, force: true })
  })
  return { root, directory, ...running }
}

test('only explicit Linux CI and two nonempty fixed lanes may launch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jig-source-refusal-'))
  try {
    const valid = {
      GITHUB_ACTIONS: 'true',
      JIG_CI_SOURCE_PARALLEL: '1',
      source_targets: 'source-portable,source-protocol',
      'BASH_FUNC_source_portable_lane%%': '() { :; }',
      'BASH_FUNC_source_other_lane%%': '() { :; }',
    }
    const cases = [
      { platform: 'darwin', env: valid },
      { platform: 'linux', env: { ...valid, GITHUB_ACTIONS: 'false' } },
      { platform: 'linux', env: { ...valid, JIG_CI_SOURCE_PARALLEL: '0' } },
      ...[
        '',
        'source-portable',
        'source-python',
        'source-portable,source-portable',
        'source-portable,unknown',
      ].map((source_targets) => ({ platform: 'linux', env: { ...valid, source_targets } })),
      { platform: 'linux', env: { ...valid, 'BASH_FUNC_source_other_lane%%': undefined } },
    ]
    for (const options of cases) {
      await assert.rejects(
        runSourceLanes({ directory: root, signals: new EventEmitter(), ...options }),
      )
      assert.deepEqual(readdirSync(root), [])
    }
    writeFileSync(join(root, 'lanes-settled'), 'old')
    await assert.rejects(
      runSourceLanes({ directory: root, platform: 'linux', env: valid }),
      /fresh owned/,
    )
    assert.deepEqual(readdirSync(root), ['lanes-settled'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('both real lanes run concurrently and settle before success', {
  timeout: 15000,
}, async (t) => {
  const f = fixture(t, 'barrier')
  assert.equal((await f.done).code, 0)
  for (const lane of ['portable', 'other']) assert.ok(existsSync(join(f.root, `${lane}.done`)))
  assert.ok(existsSync(join(f.directory, 'lanes-settled')))
  assert.match(
    readFileSync(join(f.directory, 'source_portable_lane.txt'), 'utf8'),
    /portable completed/,
  )
  assert.match(readFileSync(join(f.directory, 'source_other_lane.txt'), 'utf8'), /other completed/)
})

test('a failing lane retains its exit code and waits for the successful peer', {
  timeout: 15000,
}, async (t) => {
  const f = fixture(t, 'failure')
  assert.equal((await f.done).code, 7)
  assert.ok(existsSync(join(f.root, 'other.done')))
  assert.ok(existsSync(join(f.directory, 'lanes-settled')))
})

test('cancellation settles both live leaders and their TERM-resistant grandchildren', {
  timeout: 15000,
}, async (t) => {
  const f = fixture(t, 'cancel')
  await until(() =>
    ['portable', 'other'].every((lane) => existsSync(join(f.root, `${lane}.descendant`))),
  )
  f.child.kill('SIGTERM')
  const result = await f.done
  assert.equal(result.code, 143, result.output)
  for (const lane of ['portable', 'other']) {
    assert.equal(alive(Number(readFileSync(join(f.root, `${lane}.started`), 'utf8'))), false)
    assert.equal(alive(Number(readFileSync(join(f.root, `${lane}.descendant`), 'utf8'))), false)
  }
  assert.ok(existsSync(join(f.directory, 'lanes-settled')))
})

test('closed stdio and a successful exited leader cannot hide a live grandchild', {
  timeout: 15000,
}, async (t) => {
  const f = fixture(t, 'orphan')
  const result = await f.done
  assert.equal(result.code, 1, result.output)
  assert.ok(existsSync(join(f.root, 'other.done')))
  assert.equal(alive(Number(readFileSync(join(f.root, 'portable.descendant'), 'utf8'))), false)
  assert.ok(existsSync(join(f.directory, 'lanes-settled')))
})

test('lane shells do not source an ambient BASH_ENV', { timeout: 15000 }, async (t) => {
  const f = fixture(t, 'barrier', true)
  assert.equal((await f.done).code, 0)
  assert.equal(existsSync(join(f.root, 'ambient-ran')), false)
  for (const name of ['source_portable_lane', 'source_other_lane'])
    assert.doesNotMatch(readFileSync(join(f.directory, `${name}.txt`), 'utf8'), /ambient injection/)
})

function releaseFixture(
  t,
  { parallel = '0', mode = 'barrier', targets = 'source-portable,source-protocol' } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'jig-source-script-'))
  const bin = join(root, 'bin'),
    temp = join(root, 'tmp'),
    reports = join(root, 'reports')
  for (const path of [
    bin,
    temp,
    reports,
    join(root, 'scripts', 'ci'),
    join(root, 'conformance', 'run-0'),
  ])
    mkdirSync(path, { recursive: true })
  writeFileSync(join(root, 'scripts', 'test-release.sh'), readFileSync(sourceScript))
  writeFileSync(join(root, 'scripts', 'ci', 'source-lanes.mjs'), readFileSync(owner))
  const events = join(root, 'events')
  const testOwner = join(root, 'test-owner.mjs')
  writeFileSync(
    testOwner,
    `import{runSourceLanes}from ${JSON.stringify(new URL('./source-lanes.mjs', import.meta.url).href)};try{process.exitCode=(await runSourceLanes({directory:process.argv[3],platform:'linux'})).exitCode}catch(error){console.error(error.message);process.exitCode=1}`,
  )
  executable(join(bin, 'just'), '#!/bin/sh\nprintf "build:%s\\n" "$1" >> "$FIXTURE_EVENTS"\n')
  executable(join(bin, 'uname'), '#!/bin/sh\nprintf "Linux\\n"\n')
  executable(join(bin, 'git'), '#!/bin/sh\nprintf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"\n')
  const python = executable(
    join(bin, 'python'),
    '#!/bin/sh\nif [ "$1" = scripts/ci/merge-source-junit.py ]; then printf "<testsuites/>\\n" > "$2"; fi\nexit 0\n',
  )
  const node = executable(
    join(bin, 'qualified-node'),
    `#!/bin/sh
case "$1" in
  scripts/ci/candidate-provenance.mjs) printf 'canonical-verified\\n' >> "$FIXTURE_EVENTS"; exit 0 ;;
  --input-type=module) case "$3" in *createHash*) printf 'archive-hash\\n' >> "$FIXTURE_EVENTS" ;; esac ;;
  scripts/ci/source-lanes.mjs) shift; exec "$FIXTURE_REAL_NODE" "$FIXTURE_TEST_OWNER" "$@" ;;
  scripts/ci/suite-inventory.mjs)
    printf 'fixtures/%s.test.ts\\n' "$3"
    if [ "$3" = source-protocol ]; then printf 'fixtures/author.node.mjs\\n'; fi; exit 0 ;;
  --test)
    for arg in "$@"; do case "$arg" in --test-reporter-destination=*) printf '<testsuites/>\\n' > "\${arg#*=}" ;; esac; done
    printf 'authoring-done\\n' >> "$FIXTURE_EVENTS"; exit 0 ;;
esac
exec "$FIXTURE_REAL_NODE" "$@"
`,
  )
  executable(
    join(bin, 'bun'),
    `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const a=process.argv.slice(2),root=process.env.FIXTURE_ROOT;
const event=s=>fs.appendFileSync(process.env.FIXTURE_EVENTS,s+'\\n');
if(a[0]==='pm'||a.includes('--destination')) { const d=a[a.indexOf('--destination')+1];fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'fixture.tgz'),'frozen fixture');event('pack');process.exit(0) }
if(a[0]==='test') {
 const lane=a.includes('./fixtures/source-portable.test.ts')?'portable':'other';
 if(!fs.readFileSync(process.env.FIXTURE_EVENTS,'utf8').includes('build:authoring::build'))process.exit(93);
 if(process.env.FIXTURE_MODE==='cancel')process.on('SIGTERM',()=>{});
 fs.writeFileSync(path.join(root,lane+'.started'),String(process.pid));event(lane+'-start');
 (async()=>{
   if(process.env.FIXTURE_MODE==='failure'&&lane==='portable')process.exit(7);
   if(process.env.FIXTURE_MODE==='cancel'){setInterval(()=>{},1000);return}
   if(process.env.FIXTURE_TWO_LANES==='1'&&process.env.FIXTURE_MODE!=='failure')while(!fs.existsSync(path.join(root,(lane==='portable'?'other':'portable')+'.started')))await new Promise(r=>setTimeout(r,10));
   for(const arg of a)if(arg.startsWith('--reporter-outfile='))fs.writeFileSync(arg.slice(19),'<testsuites/>');
   event(lane+'-done');
 })().catch(()=>process.exit(94));
} else event('consumer:'+a.join(' '));
`,
  )
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    FLOW_NODE: node,
    PYTHON: python,
    TMPDIR: temp,
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: 'a'.repeat(40),
    JIG_CI_SOURCE_PARALLEL: parallel,
    FIXTURE_ROOT: root,
    FIXTURE_EVENTS: events,
    FIXTURE_REAL_NODE: process.execPath,
    FIXTURE_MODE: mode,
    FIXTURE_TEST_OWNER: testOwner,
    FIXTURE_TWO_LANES:
      parallel === '1' && targets.includes('source-portable') && targets.split(',').length > 1
        ? '1'
        : '0',
  }
  delete env.BASH_ENV
  delete env.CI_CANDIDATE_BUNDLE
  const f = {
    root,
    bin,
    temp,
    reports,
    events,
    env,
    args: [
      join(root, 'scripts', 'test-release.sh'),
      '--targets',
      targets,
      '--profile',
      'portable-linux',
      '--report-directory',
      reports,
    ],
  }
  f.start = (shell = '/bin/bash', environment = f.env) => {
    f.running = launch(shell, f.args, environment, root)
    return f.running
  }
  t.after(async () => {
    if (f.running?.child.exitCode === null) {
      f.running.child.kill('SIGTERM')
      await f.running.done
    }
    rmSync(root, { recursive: true, force: true })
  })
  return f
}

test('the actual source script prebuilds once, runs both lanes, and preserves local consumer checks', {
  timeout: 15000,
}, async (t) => {
  const f = releaseFixture(t, { parallel: '1' })
  const running = f.start()
  const result = await running.done
  assert.equal(result.code, 0, result.output)
  const events = readFileSync(f.events, 'utf8').trim().split('\n')
  assert.equal(events.filter((event) => event === 'build:authoring::build').length, 1)
  for (const lane of ['portable', 'other'])
    assert.ok(events.indexOf('build:authoring::build') < events.indexOf(`${lane}-start`))
  for (const file of ['source-portable.xml', 'source-protocol.xml', 'source-authoring.xml'])
    assert.ok(existsSync(join(f.reports, file)))
  for (const packageName of ['jig', 'display-model', 'display-web', 'display-tui'])
    assert.ok(events.includes(`consumer:packages/${packageName}/test/package-smoke.ts`))
  assert.deepEqual(readdirSync(f.temp), [])
})

test('canonical CI consumers belong to the installed candidate gate while source cases still run', {
  timeout: 15000,
}, async (t) => {
  const f = releaseFixture(t, { parallel: '1' })
  const bundle = join(f.root, 'canonical')
  for (const name of [
    'flow-sdk',
    'user-updates',
    'agent-method',
    'agent-acp',
    'display-model',
    'display-web',
    'display-tui',
    'jig',
  ]) {
    mkdirSync(join(bundle, name), { recursive: true })
    writeFileSync(join(bundle, name, 'fixture.tgz'), 'frozen canonical fixture')
  }
  const result = await f.start('/bin/bash', { ...f.env, CI_CANDIDATE_BUNDLE: bundle }).done
  assert.equal(result.code, 0, result.output)
  const events = readFileSync(f.events, 'utf8').trim().split('\n')
  assert.ok(events.includes('canonical-verified'))
  assert.ok(events.includes('portable-done') && events.includes('other-done'))
  for (const name of ['jig', 'display-model', 'display-web', 'display-tui'])
    assert.ok(!events.includes(`consumer:packages/${name}/test/package-smoke.ts`))
  assert.equal(events.filter((event) => event === 'archive-hash').length, 2)
  assert.deepEqual(readdirSync(f.temp), [])
})

test('the owning source shell joins the peer and preserves a failed lane before archive verification', {
  timeout: 15000,
}, async (t) => {
  const f = releaseFixture(t, { parallel: '1', mode: 'failure' })
  const result = await f.start().done
  assert.equal(result.code, 7, result.output)
  const events = readFileSync(f.events, 'utf8').trim().split('\n')
  assert.ok(events.includes('other-done'))
  assert.equal(events.filter((event) => event === 'archive-hash').length, 1)
  assert.deepEqual(readdirSync(f.temp), [])
})

test('standalone explicit sh remains serial and single selected stages never create an empty lane', {
  timeout: 15000,
}, async (t) => {
  for (const options of [{ parallel: '0' }, { parallel: '1', targets: 'source-protocol' }]) {
    const f = releaseFixture(t, options)
    const result = await f.start(options.parallel === '0' ? '/bin/sh' : '/bin/bash').done
    assert.equal(result.code, 0, result.output)
    const events = readFileSync(f.events, 'utf8').trim().split('\n')
    if (options.parallel === '0')
      assert.ok(events.indexOf('portable-done') < events.indexOf('other-start'))
    else assert.ok(!events.includes('portable-start'))
    assert.deepEqual(readdirSync(f.temp), [])
  }
})

test('the source shell forwards cancellation and removes its workspace only after both groups settle', {
  timeout: 15000,
}, async (t) => {
  const f = releaseFixture(t, { parallel: '1', mode: 'cancel' })
  const running = f.start()
  await until(() =>
    ['portable', 'other'].every((lane) => existsSync(join(f.root, `${lane}.started`))),
  )
  const pids = ['portable', 'other'].map((lane) =>
    Number(readFileSync(join(f.root, `${lane}.started`), 'utf8')),
  )
  running.child.kill('SIGTERM')
  const result = await running.done
  assert.equal(result.code, 143, result.output)
  for (const pid of pids) assert.equal(alive(pid), false)
  assert.deepEqual(readdirSync(f.temp), [])
})

test('unsupported opt-ins refuse before any source build or tool execution', {
  timeout: 15000,
}, async (t) => {
  for (const options of [
    { JIG_CI_SOURCE_PARALLEL: 'yes' },
    { GITHUB_ACTIONS: 'false' },
    { shell: '/bin/sh' },
  ]) {
    const f = releaseFixture(t, { parallel: '1' })
    const result = await f.start(options.shell ?? '/bin/bash', { ...f.env, ...options }).done
    assert.notEqual(result.code, 0)
    assert.match(result.output, /parallel source|Parallel source/)
    assert.equal(existsSync(f.events), false)
    assert.deepEqual(readdirSync(f.temp), [])
  }
})

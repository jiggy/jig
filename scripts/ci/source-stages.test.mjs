import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
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
import { test } from 'node:test'

function fixture(t, targets = 'source-portable,source-protocol') {
  const root = mkdtempSync(join(tmpdir(), 'jig-source-stages-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bin = join(root, 'bin'),
    temp = join(root, 'tmp'),
    reports = join(root, 'reports')
  for (const path of [bin, temp, reports, join(root, 'conformance/run-0')])
    mkdirSync(path, { recursive: true })
  const executable = (name, body) => {
    const path = join(bin, name)
    writeFileSync(path, body, { mode: 0o700 })
    return path
  }
  const script = join(root, 'test-release.sh')
  writeFileSync(script, readFileSync(new URL('../test-release.sh', import.meta.url)))
  const events = join(root, 'events')
  executable('just', '#!/bin/sh\nprintf "build:%s\\n" "$1" >> "$FIXTURE_EVENTS"\n')
  mkdirSync(join(root, 'packages/jig'), { recursive: true })
  writeFileSync(
    join(root, 'packages/jig/package.json'),
    JSON.stringify({ devDependencies: { '@jigging/flow': '0.1.0-alpha.1' } }),
  )
  executable(
    'npm',
    `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2);
const out=args[args.indexOf('--pack-destination')+1];fs.writeFileSync(path.join(out,'fixture.tgz'),'frozen fixture');fs.appendFileSync(process.env.FIXTURE_EVENTS,'pack\\n');
`,
  )
  executable('uname', '#!/bin/sh\nprintf "Linux\\n"\n')
  executable('git', '#!/bin/sh\nprintf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"\n')
  const python = executable('python', '#!/bin/sh\nexec python3 "$@"\n')
  mkdirSync(join(root, 'scripts/ci'), { recursive: true })
  for (const name of ['source-node-reporter.mjs', 'merge-source-junit.py'])
    copyFileSync(new URL(name, import.meta.url), join(root, 'scripts/ci', name))
  mkdirSync(join(root, 'fixtures'))
  for (const stage of ['portable', 'protocol'])
    writeFileSync(
      join(root, 'fixtures', `source-${stage}.node.mjs`),
      `import{test}from'node:test';import assert from'node:assert/strict';test('actual ${stage} Node fixture',()=>{assert.notEqual(process.env.FIXTURE_FAIL,'${stage}-node')});`,
    )
  const node = executable(
    'qualified-node',
    `#!/bin/sh
case "$1" in
  scripts/ci/candidate-provenance.mjs) printf 'canonical-verified\\n' >> "$FIXTURE_EVENTS"; exit 0 ;;
  --input-type=module) case "$3" in *createHash*) printf 'archive-hash\\n' >> "$FIXTURE_EVENTS" ;; esac; exit 0 ;;
  scripts/ci/suite-inventory.mjs)
    printf 'fixtures/%s.test.ts\\n' "$3"
    printf 'fixtures/%s.node.mjs\\n' "$3"; exit 0 ;;
  --test)
    case "$*" in *source-portable.node.mjs*) stage=portable ;; *) stage=protocol ;; esac
    printf '%s-node-start\\n' "$stage" >> "$FIXTURE_EVENTS"
    "$FIXTURE_REAL_NODE" "$@"; status=$?
    if [ "$status" -eq 0 ]; then printf '%s-node-done\\n' "$stage" >> "$FIXTURE_EVENTS"; fi
    exit "$status" ;;
esac
exec "$FIXTURE_REAL_NODE" "$@"
`,
  )
  executable(
    'bun',
    `#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';const a=process.argv.slice(2);
const event=s=>fs.appendFileSync(process.env.FIXTURE_EVENTS,s+'\\n');
if(a.includes('--destination')) {
 const destination=a[a.indexOf('--destination')+1];
 fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,'fixture.tgz'),'frozen fixture');event('pack');
} else if(a[0]==='test') {
 const stage=a.includes('./fixtures/source-portable.test.ts')?'portable':'protocol';event(stage+'-start');
 if(process.env.FIXTURE_FAIL===stage)process.exit(7);
 if(a.some(arg=>arg.endsWith('.node.mjs')))throw Error('Node files must not execute under Bun');
 for(const arg of a)if(arg.startsWith('--reporter-outfile='))fs.writeFileSync(arg.slice(19),'<testsuites tests="1"><testcase file="fixtures/source-'+stage+'.test.ts" name="'+stage+' controller fixture"/></testsuites>');
 event(stage+'-done');
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
    FIXTURE_EVENTS: events,
    FIXTURE_REAL_NODE: process.execPath,
  }
  delete env.NODE_TEST_CONTEXT
  delete env.CI_CANDIDATE_BUNDLE
  const run = (shell = '/bin/sh', extra = {}) =>
    spawnSync(
      shell,
      [script, '--targets', targets, '--profile', 'portable-linux', '--report-directory', reports],
      { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000 },
    )
  return {
    root,
    temp,
    reports,
    run,
    env,
    events: () => readFileSync(events, 'utf8').trim().split('\n'),
  }
}

test('source stages run serially after one shared build on both supported shells', (t) => {
  for (const shell of ['/bin/sh', '/bin/bash']) {
    const f = fixture(t),
      result = f.run(shell)
    assert.equal(result.status, 0, result.stderr)
    const events = f.events()
    assert.deepEqual(
      events.filter((event) => event.startsWith('build:')),
      ['build:jig::build'],
    )
    assert.ok(events.indexOf('build:jig::build') < events.indexOf('portable-start'))
    assert.ok(events.indexOf('portable-done') < events.indexOf('portable-node-start'))
    assert.ok(events.indexOf('portable-node-done') < events.indexOf('protocol-start'))
    assert.ok(events.indexOf('protocol-done') < events.indexOf('protocol-node-start'))
    for (const file of ['source-portable.xml', 'source-protocol.xml']) {
      assert.ok(existsSync(join(f.reports, file)))
      const report = readFileSync(join(f.reports, file), 'utf8')
      assert.match(report, /tests="2"/)
      assert.ok(report.includes(file.replace('.xml', '.node.mjs')))
      assert.ok(report.includes(file.replace('.xml', '.test.ts')))
    }
    for (const name of ['jig', 'display-model', 'display-web', 'display-tui'])
      assert.ok(events.includes(`consumer:packages/${name}/test/package-smoke.ts`))
    assert.deepEqual(readdirSync(f.temp), [])
  }
})

test('canonical CI inputs preserve source stages and delegate installed consumers without repacking', (t) => {
  const f = fixture(t),
    bundle = join(f.root, 'canonical')
  for (const name of [
    'flow-sdk',
    'reporting',
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
  const result = f.run('/bin/sh', { CI_CANDIDATE_BUNDLE: bundle })
  assert.equal(result.status, 0, result.stderr)
  const events = f.events()
  assert.ok(events.includes('canonical-verified'))
  assert.ok(events.includes('portable-done') && events.includes('protocol-done'))
  assert.ok(!events.includes('pack'))
  for (const name of ['jig', 'display-model', 'display-web', 'display-tui'])
    assert.ok(!events.includes(`consumer:packages/${name}/test/package-smoke.ts`))
  assert.equal(events.filter((event) => event === 'archive-hash').length, 2)
  assert.deepEqual(readdirSync(f.temp), [])
})

test('a failed source stage stops later stages and cannot produce successful archive revalidation', (t) => {
  const f = fixture(t),
    result = f.run('/bin/sh', { FIXTURE_FAIL: 'portable' })
  assert.equal(result.status, 7, result.stderr)
  const events = f.events()
  assert.ok(!events.includes('protocol-start'))
  assert.equal(events.filter((event) => event === 'archive-hash').length, 1)
  assert.deepEqual(readdirSync(f.temp), [])
})

test('protocol-only execution builds Jig methods and consumes the external SDK without portable tests', (t) => {
  const f = fixture(t, 'source-protocol'),
    result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const events = f.events()
  assert.deepEqual(
    events.filter((event) => event.startsWith('build:')),
    ['build:reporting::build', 'build:agent::build', 'build:acp::build'],
  )
  assert.ok(
    !events.some((event) => event.includes('authoring::build') || event.includes('flow::build')),
  )
  assert.ok(!events.includes('portable-start'))
  assert.deepEqual(readdirSync(f.temp), [])
})

test('a failed actual Node source case stops later stages and leaves no successful merged report', (t) => {
  const f = fixture(t),
    result = f.run('/bin/sh', { FIXTURE_FAIL: 'portable-node' })
  assert.notEqual(result.status, 0)
  const events = f.events()
  assert.ok(events.includes('portable-node-start'))
  assert.ok(!events.includes('portable-node-done'))
  assert.ok(!events.includes('protocol-start'))
  assert.ok(!existsSync(join(f.reports, 'source-portable.xml')))
  assert.equal(events.filter((event) => event === 'archive-hash').length, 1)
})

test('the actual root test recipe partitions Node files from both source inventories', (t) => {
  const f = fixture(t)
  const justfile = readFileSync(new URL('../../justfile', import.meta.url), 'utf8')
  const recipe = /^@test \*args:\n((?:[ \t][^\n]*\n|\n)*)/m.exec(justfile)?.[1]
  assert.ok(recipe, 'Root test recipe must remain available')
  const script = join(f.root, 'root-test.sh')
  writeFileSync(
    script,
    recipe
      .split('\n')
      .map((line) => line.replace(/^ {4}/, ''))
      .join('\n'),
  )
  const result = spawnSync('/bin/bash', [script], {
    cwd: f.root,
    env: f.env,
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /tests 2/)
  assert.ok(f.events().includes('portable-node-done'))
})

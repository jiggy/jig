import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const directory = await mkdtemp(join(tmpdir(), 'user-updates-package-'))
const root = resolve(import.meta.dir, '..')
async function run(args: string[], cwd = directory) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  assert.equal(code, 0, `${args.join(' ')}\n${stdout}\n${stderr}`)
}
try {
  const node = process.env.FLOW_NODE
  assert(node && isAbsolute(node), 'Set FLOW_NODE to an absolute independent Node executable')
  await run([
    node,
    '-e',
    'if (process.release.name !== "node" || process.versions.bun) process.exit(70)',
  ])
  const sdk = process.env.FLOW_SDK_PACKAGE_ARCHIVE
  assert(sdk && isAbsolute(sdk), 'Set FLOW_SDK_PACKAGE_ARCHIVE to the exact SDK candidate')
  const supplied = process.env.USER_UPDATES_PACKAGE_ARCHIVE
  let archive = supplied
  if (!archive) {
    archive = join(directory, 'user-updates.tgz')
    await run([process.execPath, 'pm', 'pack', '--ignore-scripts', '--filename', archive], root)
  }
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: { '@jigging/flow': `file:${sdk}`, '@jigging/user-updates': `file:${archive}` },
    }),
  )
  await run([
    'npm',
    'install',
    '--ignore-scripts',
    '--offline',
    '--no-audit',
    '--no-fund',
    '--cache',
    join(directory, 'cache'),
  ])
  assert.deepEqual(
    await readFile(join(directory, 'node_modules/@jigging/user-updates/dist/user-updates.json')),
    await readFile(join(root, 'src/user-updates.json')),
  )
  await writeFile(
    join(directory, 'consumer.mjs'),
    `
import assert from 'node:assert/strict';
import { OperationError } from '@jigging/flow';
import { withUserUpdates, USER_UPDATES_CONTRACT, validateUserUpdate } from '@jigging/user-updates';
for (const connected of [true, false]) {
  const values = [], closes = [];
  const sender = { direction: 'send', delivery: 'direct', contract: USER_UPDATES_CONTRACT,
    async send(value) { values.push(value); }, async close(options) { closes.push(options); } };
  const result = await withUserUpdates({ channels: connected ? { updates: sender } : {}, signal: new AbortController().signal }, 'updates', updates => {
    updates.activity('batch', 'Checking invoices', { completed: 2, total: 3, unit: 'invoices' });
    updates.activity('batch', 'Checking invoices', { completed: 3 });
    updates.notice('Duplicate needs review.', 'error');
    return { outcome: 'needs-review', output: { invoices: 3 } };
  });
  assert.equal(result.outcome, 'needs-review');
  assert.equal(values.length, connected ? 2 : 0);
  if (connected) { assert.deepEqual(values[0].progress, { completed: 3 }); assert.equal(values[1].severity, 'error'); }
  assert.equal(closes.length, Number(connected));
}
assert.throws(() => validateUserUpdate({kind:'notice',text:'x',extra:1}));
assert.throws(() => validateUserUpdate({kind:'notice',text:'x',severity:'fatal'}));
for (const code of ['DISCONNECTED', 'RESOURCE_EXHAUSTED']) {
  const sender = {direction:'send',delivery:'direct',contract:USER_UPDATES_CONTRACT,async send(){throw new OperationError(code)},async close(){}};
  const work = withUserUpdates({channels:{updates:sender},signal:new AbortController().signal},'updates',u=>{u.notice('one');return 'same-result'});
  if(code==='DISCONNECTED') assert.equal(await work,'same-result');
  else await assert.rejects(work,e=>e.code===code);
}
`,
  )
  for (const runtime of [process.execPath, node]) await run([runtime, 'consumer.mjs'])
  await writeFile(
    join(directory, 'consumer.ts'),
    `import { withUserUpdates, type Progress, type NoticeSeverity } from '@jigging/user-updates';
import type { RunContext, RunResult } from '@jigging/flow';
export const invoices = (run: RunContext): Promise<RunResult> => withUserUpdates(run, 'updates', updates => {
  const count: Progress = { completed: 2, total: 3, unit: 'invoices' };
  const severity: NoticeSeverity = 'warning';
  updates.notice('Duplicate needs review.', severity);
  updates.activity('batch', 'Checking invoices', count); updates.clear('batch');
  return { outcome: 'needs-review', output: null };
});`,
  )
  await run([
    process.execPath,
    join(root, 'node_modules/typescript/bin/tsc'),
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
  console.log('Packed user-updates consumer passed on Bun and Node, including public typing.')
} finally {
  await rm(directory, { recursive: true, force: true })
}

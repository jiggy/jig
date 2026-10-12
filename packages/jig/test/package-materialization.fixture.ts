import { chmod, lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalizePrivateBunExecutionLayout } from '../src/internal/bun-execution-layout.js'
import { allocatePrivatePackageMaterialization } from '../src/internal/package-materialization.js'
import { capturePackageDirectory } from '../src/package/capture.js'

const crashFixture = join(import.meta.dir, 'fixtures/package-materialization-crash.ts')
async function workspaceFixture() {
  const source = await mkdtemp(join(tmpdir(), 'jig-layout-source-'))
  const protectedParent = await realpath(
    await mkdtemp(join(tmpdir(), 'jig-layout-materializations-')),
  )
  await writeTree(source, {
    'flows/main/package.json': '{"name":"@fixture/main"}',
    'flows/main/FLOW.meta.json': JSON.stringify({
      name: 'main',
      description: 'Workspace fixture.',
    }),
    'flows/main/FLOW.ts': 'export const value = 1;\n',
    'libraries/shared/package.json': '{"name":"@fixture/shared"}',
    'libraries/shared/value.txt': 'shared bytes\n',
  })
  const captured = await capturePackageDirectory(source)
  const layout = normalizePrivateBunExecutionLayout({
    flowRoot: 'flows/main',
    members: ['flows/main', 'libraries/shared'],
    aliases: [
      { path: 'flows/main/node_modules/@fixture/shared', target: 'libraries/shared' },
      { path: 'node_modules/@fixture/shared', target: 'libraries/shared' },
    ],
  })
  const allocation = await allocatePrivatePackageMaterialization({
    protectedParent,
    name: 'run-workspace',
    packageDigest: captured.digest,
    ownerToken: 'workspace:materialization:owner',
    aliases: layout.aliases,
  })
  return {
    source,
    protectedParent,
    captured,
    layout,
    allocation,
    async dispose() {
      await captured.dispose()
      await makeFixtureRemovable(protectedParent)
      await rm(source, { recursive: true, force: true })
      await rm(protectedParent, { recursive: true, force: true })
    },
  }
}
function durableTree(): Readonly<Record<string, string>> {
  return {
    'FLOW.meta.json': JSON.stringify({ name: 'durable', description: 'Durable fixture.' }),
    'FLOW.ts': "export default 'durable';\n",
    'nested/value.txt': 'nested durable bytes\n',
    'nested/removed/value.txt': 'removed before crash\n',
    'nested/remaining/value.txt': 'retained until recovery\n',
  }
}
async function runCrashFixture(
  mode: string,
  environment: Readonly<Record<string, string>>,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([process.execPath, 'run', crashFixture], {
    env: { ...process.env, ...environment, JIG_TEST_MODE: mode },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}
async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
async function makeFixtureRemovable(root: string): Promise<void> {
  async function walk(path: string): Promise<void> {
    const information = await lstat(path).catch(() => undefined)
    if (information === undefined || information.isSymbolicLink() || !information.isDirectory())
      return
    await chmod(path, 0o700).catch(() => undefined)
    for (const name of await readdir(path).catch(() => [])) await walk(join(path, name))
  }
  await walk(root)
}

export {
  crashFixture,
  durableTree,
  makeFixtureRemovable,
  runCrashFixture,
  workspaceFixture,
  writeTree,
}

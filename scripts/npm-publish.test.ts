import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const revision = 'a'.repeat(40)
const packages = [
  ['flow', '@jigging/flow'],
  ['agent', '@jigging/agent-method'],
  ['acp', '@jigging/agent-acp'],
  ['jig', '@jigging/jig'],
] as const

async function releaseScript() {
  const source = await Bun.file(
    join(import.meta.dir, '../.github/workflows/npm-publish.yml'),
  ).text()
  const workflow = Bun.YAML.parse(source) as any
  return workflow.jobs.publish.steps.find((step: any) => step.id === 'release').run as string
}

const fakeNpm = `#!/usr/bin/env node
const { readFileSync, writeFileSync, copyFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const state = JSON.parse(readFileSync(process.env.MOCK_NPM_STATE, 'utf8'));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => writeFileSync(process.env.MOCK_NPM_STATE, JSON.stringify(state));
const error = () => { save(); process.stderr.write('npm error code E404\\n'); process.exit(1); };
if (args[0] === 'view') {
  const spec = args[1];
  if (args[2] === 'version') {
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at), version = spec.slice(at + 1);
    if (!state.packages[name]?.versions[version]) error();
    process.stdout.write(JSON.stringify(version) + '\\n');
  } else {
    const channel = args[2].slice('dist-tags.'.length);
    const pkg = state.packages[spec];
    if (!pkg) error();
    const value = pkg.tags[channel];
    if (value) process.stdout.write(JSON.stringify(value) + '\\n');
  }
  save();
} else if (args[0] === 'pack') {
  const at = args[1].lastIndexOf('@');
  const name = args[1].slice(0, at), version = args[1].slice(at + 1);
  const archive = state.packages[name]?.versions[version];
  if (!archive) error();
  const destination = args[args.indexOf('--pack-destination') + 1];
  mkdirSync(destination, { recursive: true });
  copyFileSync(archive, join(destination, 'registry.tgz'));
  save();
} else if (args[0] === 'publish') {
  const archive = args[1];
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }));
  const pkg = state.packages[manifest.name] ??= { versions: {}, tags: {} };
  pkg.versions[manifest.version] = archive;
  pkg.tags[args[args.indexOf('--tag') + 1]] = manifest.version;
  save();
} else { process.stderr.write('unexpected mock npm command: ' + args.join(' ') + '\\n'); process.exit(2); }
`

async function fixture(
  version: string,
  scenario: (data: {
    state: Record<string, any>
    archives: Record<string, string>
    root: string
  }) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'jig-npm-policy-'))
  const archives: Record<string, string> = {}
  const state: Record<string, any> = { packages: {}, calls: [] }
  const candidates = join(root, 'candidates')
  await mkdir(candidates)
  try {
    for (const [kind, name] of packages) {
      const directory = join(candidates, `npm-candidate-${kind}-test-${revision}`)
      const packageDirectory = join(root, `source-${kind}`, 'package')
      await mkdir(directory)
      await mkdir(packageDirectory, { recursive: true })
      await writeFile(
        join(packageDirectory, 'package.json'),
        JSON.stringify({ name, version, publishConfig: { access: 'public' } }),
      )
      const archive = join(directory, `${kind}.tgz`)
      const packed = spawnSync('tar', [
        '-czf',
        archive,
        '-C',
        join(root, `source-${kind}`),
        'package',
      ])
      if (packed.status !== 0) throw new Error(String(packed.stderr))
      const digest = createHash('sha256')
        .update(await readFile(archive))
        .digest('hex')
      await writeFile(`${archive}.sha256`, `${digest}  ${kind}.tgz\n`)
      await writeFile(
        join(directory, 'SUCCESS.json'),
        JSON.stringify({ archive: `${kind}.tgz`, sha256: digest, commit: revision }),
      )
      archives[name] = archive
      state.packages[name] = { versions: {}, tags: {} }
    }
    await scenario({ state, archives, root })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function run(root: string, state: Record<string, any>, group = 'host') {
  const mock = join(root, 'mock')
  await mkdir(mock)
  const executable = join(mock, 'npm')
  await writeFile(executable, fakeNpm)
  await chmod(executable, 0o755)
  const statePath = join(root, 'registry.json')
  const output = join(root, 'outputs')
  await writeFile(statePath, JSON.stringify(state))
  await writeFile(output, '')
  const script = await releaseScript()
  expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0)
  const result = spawnSync('bash', ['-e'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${mock}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      SOURCE_REVISION: revision,
      RELEASE_GROUP: group,
      GITHUB_OUTPUT: output,
      MOCK_NPM_STATE: statePath,
    },
    timeout: 30_000,
  })
  return {
    result,
    state: JSON.parse(await readFile(statePath, 'utf8')),
    output: await readFile(output, 'utf8'),
  }
}

test('newer revision completes first; delayed older revision is skipped without tag downgrade', async () => {
  await fixture('0.1.0-alpha.9', async ({ state, archives, root }) => {
    for (const [_, name] of packages) {
      state.packages[name].tags.alpha = '0.1.0-alpha.10'
      state.packages[name].versions['0.1.0-alpha.10'] = archives[name]
    }
    const result = await run(root, state)
    expect(result.result.status).toBe(0)
    expect(result.output.match(/_state=superseded/g)).toHaveLength(3)
    expect(result.state.calls.filter((call: string[]) => call[0] === 'publish')).toHaveLength(0)
    for (const [_, name] of packages)
      expect(result.state.packages[name].tags.alpha).toBe('0.1.0-alpha.10')
  })
}, 45_000)

test('older exact-version retry verifies bytes promptly despite newer tag', async () => {
  await fixture('0.1.0-alpha.9', async ({ state, archives, root }) => {
    for (const [_, name] of packages) {
      state.packages[name].versions['0.1.0-alpha.9'] = archives[name]
      state.packages[name].tags.alpha = '0.1.0-alpha.10'
    }
    const result = await run(root, state)
    expect(result.result.status).toBe(0)
    expect(result.output.match(/_state=verified/g)).toHaveLength(3)
    expect(result.result.stdout).toContain('a newer alpha tag remains unchanged')
    expect(result.state.calls.filter((call: string[]) => call[0] === 'publish')).toHaveLength(0)
  })
}, 45_000)

test('partial release verifies existing bytes before ordered missing publishes', async () => {
  await fixture('0.1.0-alpha.12', async ({ state, archives, root }) => {
    state.packages['@jigging/agent-method'].versions['0.1.0-alpha.12'] =
      archives['@jigging/agent-method']
    state.packages['@jigging/agent-method'].tags.alpha = '0.1.0-alpha.12'
    const result = await run(root, state)
    expect(result.result.status).toBe(0)
    expect(result.output).toContain('agent_state=verified')
    expect(result.output.match(/_state=published/g)).toHaveLength(2)
    const published = result.state.calls.filter((call: string[]) => call[0] === 'publish')
    expect(published.map((call: string[]) => call[1])).toEqual(
      packages.slice(2).map(([_, name]) => archives[name]),
    )
  })
}, 45_000)

test('existing bytes with missing or older tag never wait or mutate the channel', async () => {
  await fixture('0.1.0-alpha.14', async ({ state, archives, root }) => {
    for (const [_, name] of packages)
      state.packages[name].versions['0.1.0-alpha.14'] = archives[name]
    state.packages['@jigging/agent-method'].tags.alpha = '0.1.0-alpha.13'
    const result = await run(root, state)
    expect(result.result.status).toBe(0)
    expect(result.output.match(/_state=verified/g)).toHaveLength(3)
    expect(result.result.stderr).toContain('the older alpha tag cannot be changed')
    expect(result.result.stderr).toContain('the missing alpha tag cannot be changed')
    expect(result.state.calls.filter((call: string[]) => call[0] === 'publish')).toHaveLength(0)
    expect(result.state.packages['@jigging/agent-method'].tags.alpha).toBe('0.1.0-alpha.13')
  })
}, 45_000)

test('a changed host archive fails its entire group before any host publication', async () => {
  await fixture('0.1.0-alpha.15', async ({ state, archives, root }) => {
    const alternate = join(root, 'different.tgz')
    await copyFile(archives['@jigging/jig'], alternate)
    await writeFile(alternate, 'different registry bytes')
    state.packages['@jigging/jig'].versions['0.1.0-alpha.15'] = alternate
    const result = await run(root, state, 'host')
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('registry bytes differ')
    expect(result.state.calls.filter((call: string[]) => call[0] === 'publish')).toHaveLength(0)
  })
}, 45_000)

test('FLOW publishes independently even when a host candidate is invalid', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, archives, root }) => {
    await writeFile(archives['@jigging/jig'], 'invalid host archive')
    const result = await run(root, state, 'flow')
    expect(result.result.status).toBe(0)
    expect(result.output).toContain('flow_state=published')
    expect(result.output).not.toContain('jig_state=')
    expect(
      result.state.calls
        .filter((call: string[]) => call[0] === 'publish')
        .map((call: string[]) => call[1]),
    ).toEqual([archives['@jigging/flow']])
  })
}, 45_000)

test('publication and tagging use separate SDK and host qualification paths', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(join(import.meta.dir, '../.github/workflows/npm-publish.yml')).text(),
  ) as any
  const jobs = workflow.jobs
  expect(jobs.publish.needs).toBeUndefined()
  expect(jobs.publish.if).toContain("head_branch == 'main'")
  expect(jobs.publish.if).toContain("event == 'push'")
  expect(jobs.publish.if).toContain("conclusion == 'success'")
  expect(jobs.publish.env.RELEASE_GROUP).toBe('flow')
  expect(jobs.publish_host.needs).toEqual(['authorize', 'publish'])
  expect(jobs.publish_host.env.RELEASE_GROUP).toBe('host')
  expect(jobs.publish_host.steps).toEqual(jobs.publish.steps)
  expect(jobs.tag.needs).toBe('publish')
  expect(jobs.tag_host.needs).toBe('publish_host')
  for (const job of [jobs.publish, jobs.publish_host]) {
    expect(job.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
    expect(job.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBe(false)
    expect(
      job.steps.find((step: any) => step.uses?.startsWith('actions/download-artifact')).with[
        'run-id'
      ],
    ).toBe('${{ github.event.workflow_run.id }}')
  }
}, 45_000)

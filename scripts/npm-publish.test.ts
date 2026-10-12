import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

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

const fakeGithub = `#!/usr/bin/env node
const {readFileSync,writeFileSync}=require('node:fs');
const state=JSON.parse(readFileSync(process.env.MOCK_NPM_STATE,'utf8'));
const snapshot=JSON.parse(process.env.QUALIFICATION_SNAPSHOT);
const path=process.argv[3];
const runs=snapshot.runs.map(x=>({id:x.runId,run_attempt:x.runAttempt,path:x.workflowPath,event:x.event,head_sha:x.headSha,head_branch:x.headBranch,repository:{full_name:snapshot.repository},head_repository:{full_name:x.headRepository},status:'completed',conclusion:'success'}));
let result;
const run=path.match(/\\/actions\\/runs\\/(\\d+)$/);
const jobs=path.match(/\\/runs\\/(\\d+)\\/attempts\\/(\\d+)\\/jobs/);
const artifact=path.match(/\\/actions\\/artifacts\\/(\\d+)$/);
if(run){result=runs.find(x=>x.id===Number(run[1]));if(state.githubRerun || (state.githubRerunAfterRegistry && state.calls.length))result={...result,run_attempt:result.run_attempt+1};}
else if(jobs){const proof=snapshot.runs.find(x=>x.runId===Number(jobs[1]));result={jobs:proof.jobs.map(x=>({id:x.jobId,name:x.name,run_attempt:x.runAttempt,status:'completed',conclusion:'success'}))};}
else if(artifact){const proof=snapshot.artifacts.find(x=>x.artifactId===Number(artifact[1]));result={id:proof.artifactId,name:proof.name,digest:proof.digest,expired:false,expires_at:'2099-01-01T00:00:00Z',workflow_run:{id:proof.runId,head_sha:proof.headSha}};if(state.githubExpired)result.expired=true;}
else if(path.includes('/workflows/')){result={workflow_runs:runs.filter(x=>path.includes(x.path.split('/').at(-1)))};if(state.githubNewRun && result.workflow_runs.length)result.workflow_runs.push({...result.workflow_runs[0],id:9999});}
else throw Error('Unexpected GitHub API path '+path);
state.githubCalls=(state.githubCalls||0)+1;
writeFileSync(process.env.MOCK_NPM_STATE,JSON.stringify(state));
process.stdout.write(JSON.stringify(result));
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
  const receipt: any = { schemaVersion: 1, sourceRevision: revision, packages: [] }
  await mkdir(candidates)
  try {
    for (const [kind, name] of packages) {
      const archiveKind = { flow: 'flow-sdk', agent: 'agent-method', acp: 'agent-acp', jig: 'jig' }[
        kind
      ]
      const directory = join(candidates, archiveKind)
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
      receipt.packages.push({
        kind: archiveKind,
        name,
        version,
        archive: relative(candidates, archive),
        sha256: digest,
      })
      state.packages[name] = { versions: {}, tags: {} }
    }
    await writeFile(join(candidates, 'CANDIDATE.json'), JSON.stringify(receipt))
    await writeFile(
      join(root, 'authorized-receipt.sha256'),
      createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),
    )
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
  await writeFile(join(mock, 'gh'), fakeGithub)
  await chmod(join(mock, 'gh'), 0o755)
  const statePath = join(root, 'registry.json')
  const output = join(root, 'outputs')
  await writeFile(statePath, JSON.stringify(state))
  await writeFile(output, '')
  const script = await releaseScript()
  const receiptSha256 = await readFile(join(root, 'authorized-receipt.sha256'), 'utf8')
  const repository = 'fixture/jig'
  const paths = [
    'ci.yml',
    ...(group === 'host'
      ? [
          'linux-host-conformance.yml',
          'macos-hosted-candidates.yml',
          'native-agent-api-qualification.yml',
        ]
      : []),
  ]
  const runs = paths.map((path, index) => ({
    runId: index + 1,
    runAttempt: 1,
    workflowPath: `.github/workflows/${path}`,
    event: index === 3 ? 'workflow_run' : 'push',
    headSha: revision,
    headBranch: 'main',
    headRepository: repository,
    jobs: [{ jobId: index + 11, name: `proof-${index}`, runId: index + 1, runAttempt: 1 }],
  }))
  const snapshot = {
    schemaVersion: 1,
    repository,
    group,
    sourceRevision: revision,
    candidate: {
      sourceRevision: revision,
      receiptSha256,
      producerRunId: 1,
      producerRunAttempt: 1,
      artifactId: 1,
      artifactDigest: `sha256:${'c'.repeat(64)}`,
    },
    runs,
    artifacts: Array.from({ length: group === 'host' ? 7 : 1 }, (_, index) => ({
      artifactId: index + 1,
      name: `proof-artifact-${index}`,
      digest: `sha256:${'c'.repeat(64)}`,
      runId: Math.min(index + 1, runs.length),
      headSha: revision,
    })),
  }
  expect(spawnSync('bash', ['-n'], { input: script }).status).toBe(0)
  const result = spawnSync('bash', ['-e'], {
    input: script,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${mock}:${process.env.PATH}`,
      RUNNER_TEMP: root,
      SOURCE_REVISION: revision,
      EXPECTED_RECEIPT_SHA256: receiptSha256,
      GITHUB_REPOSITORY: repository,
      QUALIFICATION_SNAPSHOT: JSON.stringify(snapshot),
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

test('changed candidate digest sidecars fail before any registry mutation', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, archives, root }) => {
    await writeFile(`${archives['@jigging/agent-method']}.sha256`, 'wrong digest\n')
    const result = await run(root, state, 'host')
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('candidate digest sidecar does not match')
    expect(result.state.calls).toEqual([])
  })
})

test('replayed candidate receipts fail before registry reads or publication', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, root }) => {
    const path = join(root, 'candidates', 'CANDIDATE.json')
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    receipt.sourceRevision = 'b'.repeat(40)
    await writeFile(path, JSON.stringify(receipt))
    const result = await run(root, state)
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('candidate receipt differs from authorized artifact')
    expect(result.state.calls).toEqual([])
  })
})

test('self-consistent replacement archives still require the authorized candidate hash', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, archives, root }) => {
    const archive = archives['@jigging/agent-method']!
    // A valid alternate archive, with forged matching sidecar and local success,
    // cannot replace the bytes authorized by the producer's root receipt.
    const changed = join(root, 'source-agent', 'package', 'changed.txt')
    await writeFile(changed, 'replacement bytes')
    expect(
      spawnSync('tar', ['-czf', archive, '-C', join(root, 'source-agent'), 'package']).status,
    ).toBe(0)
    const digest = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')
    await writeFile(`${archive}.sha256`, `${digest}  agent.tgz\n`)
    await writeFile(
      join(root, 'candidates', 'agent-method', 'SUCCESS.json'),
      JSON.stringify({ archive: 'agent.tgz', sha256: digest, commit: revision }),
    )
    const result = await run(root, state)
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('candidate archive differs from authorized receipt')
    expect(result.state.calls).toEqual([])
  })
})

test('a queued release refuses a changed qualification attempt before registry access', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, root }) => {
    state.githubRerun = true
    const result = await run(root, state)
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('Qualification run changed after authorization')
    expect(result.state.calls).toEqual([])
  })
})

test('a rerun starting during registry preflight prevents ordered mutation', async () => {
  await fixture('0.1.0-alpha.16', async ({ state, root }) => {
    state.githubRerunAfterRegistry = true
    const result = await run(root, state)
    expect(result.result.status).not.toBe(0)
    expect(result.result.stderr).toContain('Qualification run changed after authorization')
    expect(result.state.calls.length).toBeGreaterThan(0)
    expect(result.state.calls.filter((call: string[]) => call[0] === 'publish')).toEqual([])
  })
}, 45_000)

test('newer same-source runs and expired evidence invalidate queued publication', async () => {
  for (const key of ['githubNewRun', 'githubExpired']) {
    await fixture('0.1.0-alpha.16', async ({ state, root }) => {
      state[key] = true
      const result = await run(root, state)
      expect(result.result.status).not.toBe(0)
      expect(result.state.calls).toEqual([])
    })
  }
}, 45_000)

test('publication and tagging use separate SDK and host qualification paths', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(join(import.meta.dir, '../.github/workflows/npm-publish.yml')).text(),
  ) as any
  const jobs = workflow.jobs
  expect(jobs.publish.needs).toBe('authorize')
  expect(jobs.publish.if).toContain("ready_flow == 'true'")
  expect(jobs.authorize['timeout-minutes']).toBe(5)
  expect(jobs.publish.env.RELEASE_GROUP).toBe('flow')
  expect(jobs.publish_host.needs).toEqual(['authorize', 'publish'])
  expect(jobs.publish_host.env.RELEASE_GROUP).toBe('host')
  expect(jobs.publish_host.steps).toEqual(jobs.publish.steps)
  expect(jobs.tag.needs).toEqual(['authorize', 'publish'])
  expect(jobs.tag_host.needs).toEqual(['authorize', 'publish_host'])
  for (const job of [jobs.publish, jobs.publish_host]) {
    expect(job.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
    expect(job.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBe(false)
    expect(
      job.steps.find((step: any) => step.uses?.startsWith('actions/download-artifact')).with[
        'run-id'
      ],
    ).toBe('${{ needs.authorize.outputs.producer_run_id }}')
    expect(
      job.steps.find((step: any) => step.uses?.startsWith('actions/download-artifact')).with[
        'artifact-ids'
      ],
    ).toBe('${{ needs.authorize.outputs.candidate_artifact_id }}')
  }
}, 45_000)

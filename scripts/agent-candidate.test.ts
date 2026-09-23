import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
test('Agent candidate refuses malformed requests and missing tools before creating output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-candidate-refusal-'))
  try {
    for (const args of [
      [],
      ['unknown', join(directory, 'candidate')],
      ['agent-acp', join(directory, 'candidate')],
    ]) {
      const child = Bun.spawn(
        [process.execPath, join(root, 'scripts/build-agent-candidate.ts'), ...args],
        {
          env: { PATH: process.env.PATH!, FLOW_NODE: '', FLOW_NPM: '' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const stderr = new Response(child.stderr).text()
      expect(await child.exited).not.toBe(0)
      expect(await stderr).toContain(args[0] === 'agent-acp' ? 'FLOW_NODE' : 'usage:')
      expect(await readdir(directory)).toEqual([])
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('ordinary Agent publishing uses exact candidates and retains separate authority gates', async () => {
  const ci = Bun.YAML.parse(await Bun.file(join(root, '.github/workflows/ci.yml')).text()) as any
  const workflow = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/npm-publish.yml')).text(),
  ) as any
  const candidate = ci.jobs['npm-candidate']
  const { publish, authorize, tag } = workflow.jobs
  expect(candidate.strategy.matrix.package).toEqual(['flow', 'agent', 'acp', 'jig'])
  expect(ci.permissions).toEqual({ contents: 'read' })
  expect(publish.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
  expect(publish.needs).toBe('authorize')
  expect(authorize.name).toContain('same-revision')
  expect(publish.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBeFalse()
  const download = publish.steps.find(
    (step: any) => step.name === 'Download exact persisted candidates',
  )
  expect(download.with.pattern).toContain('${{ env.SOURCE_REVISION }}')
  expect(download.with['run-id']).toBe('${{ github.event.workflow_run.id }}')
  expect(download.with['github-token']).toBe('${{ github.token }}')
  const script = publish.steps.find((step: any) => step.id === 'release').run
  const calls = script.split('\n').filter((line: string) => /^publish_candidate /.test(line))
  expect(calls).toEqual([
    'publish_candidate flow @jigging/flow',
    'publish_candidate agent @jigging/agent-method',
    'publish_candidate acp @jigging/agent-acp',
    'publish_candidate jig @jigging/jig',
  ])
  expect(script).toContain('registry bytes differ')
  expect(script).toContain('success.commit !== process.env.SOURCE_REVISION')
  expect(tag.permissions).toEqual({ contents: 'write' })
  for (const kind of ['agent', 'acp']) {
    expect(publish.outputs[`${kind}_version`]).toBeDefined()
    expect(publish.outputs[`${kind}_new`]).toBeDefined()
  }
})

test('Python publication reuses the exact CI-qualified candidate', async () => {
  const ci = Bun.YAML.parse(await Bun.file(join(root, '.github/workflows/ci.yml')).text()) as any
  const workflow = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/pypi-publish.yml')).text(),
  ) as any
  expect(
    ci.jobs['python-build'].steps.some((step: any) => step.run?.includes('python::candidate')),
  ).toBeTrue()
  expect(ci.jobs['python-installed'].needs).toBe('python-build')
  expect(workflow.jobs.build).toBeUndefined()
  expect(workflow.jobs.qualify).toBeUndefined()
  expect(workflow.jobs.prepare.needs).toBe('authorize')
  for (const job of [workflow.jobs.prepare, workflow.jobs.verify]) {
    const download = job.steps.find((step: any) =>
      step.uses?.startsWith('actions/download-artifact'),
    )
    expect(download.with.name).toBe('python-candidate-${{ env.SOURCE_REVISION }}')
    expect(download.with['run-id']).toBe('${{ github.event.workflow_run.id }}')
    expect(download.with['github-token']).toBe('${{ github.token }}')
  }
})

test('Linux host shards retain complete coverage and fail-closed aggregation', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/linux-host-conformance.yml')).text(),
  ) as any
  const artifacts = workflow.jobs['host-artifacts']
  const suites = workflow.jobs['host-suite']
  const aggregate = workflow.jobs['rootless-linux']
  expect(suites.needs).toBe('host-artifacts')
  expect(suites.strategy['fail-fast']).toBeFalse()
  expect(suites.strategy.matrix.suite).toEqual([
    'agent-lifecycle',
    'delegated-authority',
    'installed-evidence',
  ])
  const proofSteps = suites.steps
    .filter(
      (step: any) =>
        step.name?.startsWith('Prove ') ||
        step.name?.startsWith('Run Operational') ||
        step.name?.startsWith('Attack '),
    )
    .map((step: any) => step.name)
  expect(proofSteps).toEqual([
    'Prove transient delegation and lifetime fencing',
    'Prove the rootless Run envelope',
    'Prove the Agent lifecycle and ordinary method composition',
    'Prove the finite foreground product path',
    'Prove contained project commands',
    'Prove delegated HTTP authority and coordinator-loss cleanup',
    'Prove contained native preparation',
    'Prove retained progress and coordinator-loss delivery',
    'Prove ordinary ACP Agent progress and cancellation',
    'Prove installed Markdown and exact typed calls',
    'Run Operational Baseline/1 against the packed archive',
    'Attack the packed CLI inside the proved envelope',
  ])
  expect(
    suites.steps.find((step: any) => step.name === 'Verify the tested archives are unchanged').if,
  ).toBe('always()')
  expect(suites.steps.find((step: any) => step.name === 'Require zero host residue').if).toContain(
    'always()',
  )
  expect(aggregate.name).toBe('rootless-linux')
  expect(aggregate.if).toBe('always()')
  expect(aggregate.needs).toEqual(['host-artifacts', 'host-suite'])
  expect(aggregate.steps[0].run).toContain('!= success')
  expect(
    artifacts.steps.some((step: any) => step.name === 'Retain exact Linux host artifacts'),
  ).toBeTrue()
})

import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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
  const { publish_host: publish, authorize, tag_host: tag } = workflow.jobs
  expect(candidate.strategy.matrix.package).toEqual(['flow', 'agent', 'acp', 'jig'])
  expect(ci.permissions).toEqual({ contents: 'read' })
  expect(publish.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
  expect(publish.needs).toEqual(['authorize', 'publish'])
  expect(authorize.name).toContain('same-revision')
  expect(publish.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBeFalse()
  const download = publish.steps.find(
    (step: any) => step.name === 'Download exact persisted candidates',
  )
  expect(download.with.pattern).toContain('${{ env.SOURCE_REVISION }}')
  expect(download.with['run-id']).toBe('${{ github.event.workflow_run.id }}')
  expect(download.with['github-token']).toBe('${{ github.token }}')
  const script = publish.steps.find((step: any) => step.id === 'release').run
  expect(publish.env.RELEASE_GROUP).toBe('host')
  expect(script).toContain('host) package_kinds="agent acp jig"')
  expect(script).toContain('for PREFLIGHT in true false; do')
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
  expect(workflow['true'].workflow_dispatch?.inputs?.qualify_codex_api).toBeUndefined()
  expect(aggregate.steps[0].run).toContain('!= success')
  expect(
    artifacts.steps.some((step: any) => step.name === 'Retain exact Linux host artifacts'),
  ).toBeTrue()
})

test('native API qualification is automatic, exact-revision, and scoped to supported clients', async () => {
  const host = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/linux-host-conformance.yml')).text(),
  ) as any
  const live = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/native-agent-api-qualification.yml')).text(),
  ) as any
  const publish = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/npm-publish.yml')).text(),
  ) as any
  const pypi = await Bun.file(join(root, '.github/workflows/pypi-publish.yml')).text()
  const trigger = live['true'].workflow_run
  const qualification = live.jobs.qualification
  const matrix = qualification.strategy.matrix.include
  const codexInstall = qualification.steps.find(
    (step: any) => step.name === 'Install current native Codex',
  )
  const claudeInstall = qualification.steps.find(
    (step: any) => step.name === 'Install current native Claude Code',
  )
  const piInstall = qualification.steps.find(
    (step: any) => step.name === 'Install the supported standalone Pi profile',
  )
  const apiSteps = qualification.steps.filter((step: any) =>
    step.name?.startsWith('Qualify native '),
  )
  const secretScopes = Object.entries(live.jobs).flatMap(([jobId, job]: [string, any]) =>
    (job.steps ?? [])
      .filter((step: any) => step.env?.OPENROUTER_API_KEY !== undefined)
      .map((step: any) => `${jobId}:${step.name}`),
  )
  const downloads = qualification.steps.filter((step: any) =>
    step.uses?.startsWith('actions/download-artifact'),
  )
  const publishAuthorization = publish.jobs.authorize

  expect(host.jobs['rootless-linux'].needs).toEqual(['host-artifacts', 'host-suite'])
  expect(trigger.workflows).toEqual(['Linux host conformance'])
  expect(trigger.types).toEqual(['completed'])
  expect(live['true'].workflow_dispatch).toBeNull()
  expect(live['run-name']).toContain('github.event.workflow_run.head_sha')
  expect(live['run-name']).toContain('github.sha')
  expect(live.env.JIG_NATIVE_API_MODEL).toBeUndefined()
  expect(qualification.if).toContain("github.event.workflow_run.conclusion == 'success'")
  expect(qualification.if).toContain("github.event_name == 'workflow_dispatch'")
  expect(qualification.if).toContain("github.ref == 'refs/heads/main'")
  expect(qualification.if).toContain("github.event.workflow_run.event == 'push'")
  expect(qualification.if).toContain("github.event.workflow_run.head_branch == 'main'")
  expect(qualification.if).toContain(
    'github.event.workflow_run.head_repository.full_name == github.repository',
  )
  expect(qualification.environment).toBe('native-agent-api')
  expect(qualification.permissions).toEqual({ actions: 'read', contents: 'read' })
  expect(qualification.strategy['max-parallel']).toBe(3)
  expect(matrix.map((entry: any) => entry.client)).toEqual(['codex', 'claude', 'pi'])
  expect(matrix.map((entry: any) => ({ client: entry.client, model: entry.model }))).toEqual([
    { client: 'codex', model: 'openrouter/free' },
    { client: 'claude', model: 'mistralai/ministral-8b-2512' },
    { client: 'pi', model: 'mistralai/ministral-8b-2512' },
  ])
  expect(codexInstall.run).toContain('@openai/codex@latest')
  expect(codexInstall.run).toContain('--version')
  expect(claudeInstall.run).toContain('@anthropic-ai/claude-code@latest')
  expect(piInstall.run).toContain('pi_version=0.84.4')
  expect(piInstall.run).toContain('SHA256SUMS')
  expect(apiSteps.map((step: any) => step.name)).toEqual([
    'Qualify native ${{ matrix.client }} API-key ACP through OpenRouter',
  ])
  expect(
    apiSteps.every(
      (step: any) => step.env.OPENROUTER_API_KEY === '${{ secrets.OPENROUTER_API_KEY }}',
    ),
  ).toBeTrue()
  expect(
    apiSteps.every((step: any) => step.env.JIG_NATIVE_API_MODEL === '${{ matrix.model }}'),
  ).toBeTrue()
  expect(secretScopes).toEqual([
    'qualification:Qualify native ${{ matrix.client }} API-key ACP through OpenRouter',
  ])
  expect(downloads).toHaveLength(1)
  expect(downloads[0].with.name).toBe('linux-host-artifacts-${{ env.SOURCE_REVISION }}')
  expect(downloads[0].with['run-id']).toBe('${{ steps.host-run.outputs.run_id }}')
  expect(downloads[0].with['github-token']).toBe('${{ github.token }}')
  const hostRun = qualification.steps.find((step: any) => step.id === 'host-run')
  expect(hostRun.run).toContain('.head_sha == $revision')
  expect(hostRun.run).toContain('.conclusion == "success"')
  expect(
    qualification.steps.some(
      (step: any) =>
        step.name === 'Verify the tested archives are unchanged' && step.if.includes('always()'),
    ),
  ).toBeTrue()
  expect(
    qualification.steps.some(
      (step: any) => step.name === 'Require zero host residue' && step.if.includes('always()'),
    ),
  ).toBeTrue()
  expect(publishAuthorization['timeout-minutes']).toBe(90)
  expect(
    publishAuthorization.steps.some(
      (step: any) => step.name === 'Require exact-revision native Agent API qualification',
    ),
  ).toBeTrue()
  expect(pypi.includes('require-native-agent-api-qualification.sh')).toBeFalse()
})

test('manual native qualification selects only a successful main-push host run for its exact revision', async () => {
  const live = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/native-agent-api-qualification.yml')).text(),
  ) as any
  const script = live.jobs.qualification.steps.find((step: any) => step.id === 'host-run').run
  const directory = await mkdtemp(join(tmpdir(), 'native-agent-host-run-'))
  const bin = join(directory, 'bin')
  const response = join(directory, 'response.json')
  const output = join(directory, 'output')
  const revision = 'a'.repeat(40)
  try {
    await mkdir(bin)
    await writeFile(join(bin, 'gh'), '#!/bin/sh\ncat "$MOCK_HOST_RUNS"\n')
    await chmod(join(bin, 'gh'), 0o755)
    const run = async (runs: unknown[], trigger = '') => {
      await writeFile(response, JSON.stringify({ workflow_runs: runs }))
      await writeFile(output, '')
      const child = Bun.spawn(['/bin/bash', '-e', '-c', script], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MOCK_HOST_RUNS: response,
          GITHUB_REPOSITORY: 'jiggy/jig',
          GITHUB_OUTPUT: output,
          SOURCE_REVISION: revision,
          TRIGGER_RUN_ID: trigger,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const stderr = new Response(child.stderr).text()
      return {
        exit: await child.exited,
        stderr: await stderr,
        output: await Bun.file(output).text(),
      }
    }
    const matching = {
      id: 42,
      head_sha: revision,
      head_branch: 'main',
      conclusion: 'success',
      event: 'push',
      created_at: '2026-09-25T10:00:00Z',
    }
    expect((await run([{ ...matching, head_sha: 'b'.repeat(40) }, matching])).output).toBe(
      'run_id=42\n',
    )
    expect((await run([{ ...matching, conclusion: 'failure' }])).exit).toBe(1)
    expect((await run([{ ...matching, event: 'pull_request' }])).exit).toBe(1)
    expect((await run([], '91')).output).toBe('run_id=91\n')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native API publication gate waits for this revision and rejects an exact-revision failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-agent-api-gate-'))
  const bin = join(directory, 'bin')
  const script = join(root, 'scripts/require-native-agent-api-qualification.sh')
  const revision = 'a'.repeat(40)
  const otherRevision = 'b'.repeat(40)
  const calls = join(directory, 'gh-calls')
  const state = join(directory, 'gh-state')

  async function runFixture(first: string, response: string, scriptPath = script) {
    await writeFile(
      join(bin, 'gh'),
      '#!/bin/sh\nset -eu\nprintf \'call\\n\' >> "$MOCK_GH_CALLS"\nif [ ! -f "$MOCK_GH_STATE" ]; then : > "$MOCK_GH_STATE"; printf \'%s\' "$MOCK_GH_FIRST"; else printf \'%s\' "$MOCK_GH_RESPONSE"; fi\n',
    )
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n')
    await chmod(join(bin, 'gh'), 0o755)
    await chmod(join(bin, 'sleep'), 0o755)
    const child = Bun.spawn(['/bin/sh', scriptPath, 'jiggy/jig', revision], {
      cwd: directory,
      env: {
        ...process.env,
        GH_TOKEN: 'fixture-token',
        MOCK_GH_CALLS: calls,
        MOCK_GH_STATE: state,
        MOCK_GH_FIRST: first,
        MOCK_GH_RESPONSE: response,
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: directory,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = new Response(child.stdout).text()
    const stderr = new Response(child.stderr).text()
    return { exit: await child.exited, stdout: await stdout, stderr: await stderr }
  }

  try {
    await mkdir(bin)
    const otherRevisionRun = JSON.stringify({
      workflow_runs: [
        {
          conclusion: 'success',
          created_at: '2026-09-25T10:00:00Z',
          display_title: `Native Agent API qualification for ${otherRevision}`,
          event: 'workflow_run',
          html_url: 'https://example.invalid/other',
          status: 'completed',
        },
      ],
    })
    const exactSuccess = JSON.stringify({
      workflow_runs: [
        {
          conclusion: 'success',
          created_at: '2026-09-25T10:01:00Z',
          display_title: `Native Agent API qualification for ${revision}`,
          event: 'workflow_run',
          html_url: 'https://example.invalid/exact',
          status: 'completed',
        },
      ],
    })
    const success = await runFixture(otherRevisionRun, exactSuccess)
    expect(success.exit).toBe(0)
    expect(success.stdout).toContain(`succeeded for ${revision}`)
    expect((await Bun.file(calls).text()).trim().split('\n')).toHaveLength(2)

    await rm(calls, { force: true })
    await rm(state, { force: true })
    const manualSuccess = JSON.stringify({
      workflow_runs: [
        {
          conclusion: 'success',
          created_at: '2026-09-25T10:03:00Z',
          display_title: `Native Agent API qualification for ${revision}`,
          event: 'workflow_dispatch',
          head_branch: 'main',
          head_sha: revision,
          html_url: 'https://example.invalid/manual',
          status: 'completed',
        },
      ],
    })
    const manual = await runFixture(manualSuccess, manualSuccess)
    expect(manual.exit).toBe(0)
    expect(manual.stdout).toContain(`succeeded for ${revision}`)

    await rm(calls, { force: true })
    await rm(state, { force: true })
    const wrongManual = JSON.stringify({
      workflow_runs: [{ ...JSON.parse(manualSuccess).workflow_runs[0], head_sha: otherRevision }],
    })
    const wrongManualRun = await runFixture(wrongManual, exactSuccess)
    expect(wrongManualRun.exit).toBe(0)
    expect((await Bun.file(calls).text()).trim().split('\n')).toHaveLength(2)

    await rm(calls, { force: true })
    await rm(state, { force: true })
    const fastScript = join(directory, 'gate-fast-poll.sh')
    const source = await Bun.file(script).text()
    expect(source.match(/attempts=240/g)).toHaveLength(1)
    expect(source.match(/delay_seconds=10/g)).toHaveLength(1)
    await writeFile(
      fastScript,
      source.replace('attempts=240', 'attempts=2').replace('delay_seconds=10', 'delay_seconds=0'),
    )
    const noMatch = await runFixture(otherRevisionRun, otherRevisionRun, fastScript)
    expect(noMatch.exit).toBe(1)
    expect(noMatch.stderr).toContain('before the authorization deadline')
    expect((await Bun.file(calls).text()).trim().split('\n')).toHaveLength(2)

    await rm(calls, { force: true })
    await rm(state, { force: true })
    const exactFailure = JSON.stringify({
      workflow_runs: [
        {
          conclusion: 'failure',
          created_at: '2026-09-25T10:02:00Z',
          display_title: `Native Agent API qualification for ${revision}`,
          event: 'workflow_run',
          html_url: 'https://example.invalid/failed',
          status: 'completed',
        },
      ],
    })
    const failure = await runFixture(exactFailure, exactFailure)
    expect(failure.exit).toBe(1)
    expect(failure.stderr).toContain(`did not succeed for ${revision}`)
    expect(failure.stderr).toContain('https://example.invalid/failed')
    expect((await Bun.file(calls).text()).trim().split('\n')).toHaveLength(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

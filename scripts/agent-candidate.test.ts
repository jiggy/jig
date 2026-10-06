import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
// Bun 1.3 parses YAML's unquoted `on` as a boolean; Bun 1.4 preserves its name.
const workflowTriggers = (workflow: any) => workflow.on ?? workflow.true
test('the source gate refuses missing prerequisites before starting builds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-gate-preflight-'))
  const node = Bun.which('node')
  if (!node) throw new Error('source gate tests require genuine Node')
  try {
    const bin = join(directory, 'bin')
    const calls = join(directory, 'build-calls')
    await mkdir(bin)
    await mkdir(join(directory, 'conformance/run-0'), { recursive: true })
    for (const [name, body] of [
      ['bun', 'exit "$MOCK_DEPENDENCY_STATUS"'],
      ['python', 'if [ "$1" = --version ]; then exit 0; fi; exit "$MOCK_PYTHON_STATUS"'],
      ['just', 'echo build >> "$MOCK_BUILD_CALLS"; exit 79'],
    ]) {
      await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`)
      await chmod(join(bin, name), 0o755)
    }
    for (const [pythonStatus, dependencyStatus, expected, diagnostic] of [
      ['1', '0', 1, 'Install release test tools'],
      ['0', '1', 1, 'Install protocol fixture dependencies'],
      ['0', '0', 79, ''],
    ] as const) {
      await writeFile(calls, '')
      const result = spawnSync('/bin/sh', [join(root, 'scripts/test-release.sh')], {
        cwd: directory,
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          FLOW_NODE: node,
          PYTHON: join(bin, 'python'),
          MOCK_BUILD_CALLS: calls,
          MOCK_PYTHON_STATUS: pythonStatus,
          MOCK_DEPENDENCY_STATUS: dependencyStatus,
        },
        encoding: 'utf8',
      })
      expect(result.status).toBe(expected)
      expect(result.stderr).toContain(diagnostic)
      expect(await Bun.file(calls).text()).toBe(expected === 79 ? 'build\n' : '')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('PRs start complete hosted Mac qualification and quick checks finish independently', async () => {
  const load = async (file: string) =>
    Bun.YAML.parse(await Bun.file(join(root, '.github/workflows', file)).text()) as any
  const mac = await load('macos-hosted-candidates.yml')
  const ci = await load('ci.yml')
  expect(Object.hasOwn(workflowTriggers(mac), 'pull_request')).toBeTrue()
  const macPaths = workflowTriggers(mac).pull_request.paths as string[]
  for (const input of [
    'packages/jig/test/new-host-case.test.ts',
    'packages/agent-method/src/api.ts',
    'packages/agent-acp/src/flow.ts',
    'packages/flow-authoring/src/index.ts',
    'packages/flow-sdk/src/index.ts',
    'docs/flow/spec/machine/invocation-contract-0.schema.json',
    'docs/jig/spec/contracts/agent-run/contract.json',
    'examples/incident-brief/flows/worker/FLOW.ts',
    'scripts/ci/qualify-macos-host.sh',
    'scripts/test-installed-hostile-baseline.ts',
    '.github/workflows/macos-hosted-candidates.yml',
    'justfile',
    'package.json',
    'LICENSE.md',
    'PRICING.md',
    'LICENSES.md',
    'LICENSES/MPL-2.0.txt',
    'RELEASING.md',
  ]) {
    expect(macPaths.some((pattern) => new Bun.Glob(pattern).match(input))).toBeTrue()
  }
  expect(
    macPaths.some((pattern) => new Bun.Glob(pattern).match('docs/jig/guide/teams.md')),
  ).toBeFalse()
  expect(workflowTriggers(mac).push.branches).toEqual(['main'])
  expect(mac.permissions).toEqual({ contents: 'read' })
  expect(mac.jobs.prerequisites.environment).toBeUndefined()
  expect(mac.jobs.prerequisites.strategy['max-parallel']).toBe(5)
  const { MAC_HOST_SHARDS } = await import('./ci/macos-host-test-shards.mjs')
  const entries = mac.jobs.prerequisites.strategy.matrix.include
  expect(entries).toHaveLength(5)
  for (const [arch, count] of Object.entries(MAC_HOST_SHARDS)) {
    const selected = entries.filter((e: any) => e.arch === arch)
    expect(selected.map((e: any) => e.shard).sort()).toEqual(
      Array.from({ length: count }, (_, i) => i),
    )
    expect(selected.filter((e: any) => e.installed).map((e: any) => e.shard)).toEqual([count - 1])
  }
  expect(mac.jobs['qualified-architecture'].strategy.matrix.include).toEqual([
    { arch: 'x64', count: MAC_HOST_SHARDS.x64 },
    { arch: 'arm64', count: MAC_HOST_SHARDS.arm64 },
  ])
  expect(mac.jobs['qualified-architecture'].permissions).toEqual({
    contents: 'read',
    actions: 'read',
  })
  const summary = mac.jobs['qualified-architecture'].steps.find((s: any) =>
    s.run?.includes('macos-host-summary.py'),
  )
  expect(summary.if).toBe('always()')
  expect(summary.env.SHARD_COUNT).toBe('${{ matrix.count }}')
  expect(summary.run).toContain('>> "$GITHUB_STEP_SUMMARY"')
  expect(
    mac.jobs.prerequisites.steps.find(
      (s: any) => s.name === 'Prepare genuine pinned clients for offline startup',
    ).if,
  ).toBe('matrix.installed')
  expect(mac.concurrency['cancel-in-progress']).toContain("github.ref != 'refs/heads/main'")
  for (const job of ['quick-checks', 'sites', 'source-tests', 'npm-candidate']) {
    expect(ci.jobs[job].needs).toBeUndefined()
  }
  expect(
    ci.jobs['quick-checks'].steps.some((step: any) => step.run === 'just test-tooling'),
  ).toBeTrue()
  const preflight = ci.jobs['npm-candidate'].steps.find((step: any) =>
    step.run?.includes('npm-candidate-preflight.mjs'),
  )
  expect(preflight.env.SOURCE_REVISION).toBe('${{ github.sha }}')
  expect(
    ci.jobs['source-tests'].steps.some((step: any) =>
      step.run?.includes('scripts/test-release.sh'),
    ),
  ).toBeTrue()
  expect(ci.jobs.test.if).toBe('always()')
  expect(ci.jobs.test.needs).toEqual(['quick-checks', 'sites', 'source-tests'])
  const script = ci.jobs.test.steps[0].run
  for (const key of ['QUICK', 'SITES', 'SOURCE']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const child = spawnSync('/bin/sh', ['-c', script], {
        env: { QUICK: 'success', SITES: 'success', SOURCE: 'success', [key]: result },
      })
      expect(child.status).toBe(result === 'success' ? 0 : 1)
    }
  }
})

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
    'package-lifecycle',
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
    'Prove packed source edits reuse dependencies without reusing authority',
    'Prove ordinary ACP Agent progress and cancellation',
    'Prove installed Markdown and exact typed calls',
    'Prove installed workspace dependency admission and execution',
    'Prove complete packed CLI composition',
    'Run Operational Baseline/1 against the packed archive',
    'Attack the packed CLI inside the proved envelope',
  ])
  const dependencyReuse = suites.steps.find(
    (step: any) =>
      step.name === 'Prove packed source edits reuse dependencies without reusing authority',
  )
  expect(dependencyReuse.if).toBe("matrix.suite == 'package-lifecycle'")
  expect(dependencyReuse.run).toContain('"JIG_PACKAGE_ARCHIVE=$JIG_PACKAGE_ARCHIVE"')
  expect(dependencyReuse.run).toContain("-t '^packed project dependencies '")
  const preparation = suites.steps.find(
    (step: any) => step.name === 'Prove contained native preparation',
  )
  expect(preparation.if).toBe("matrix.suite == 'package-lifecycle'")
  expect(preparation.run).toContain('packages/jig/test/project-author-evaluator.test.ts')
  const packageProofs = [
    'Prove contained native preparation',
    'Prove retained progress and coordinator-loss delivery',
    'Prove packed source edits reuse dependencies without reusing authority',
    'Prove ordinary ACP Agent progress and cancellation',
    'Prove installed Markdown and exact typed calls',
    'Prove installed workspace dependency admission and execution',
  ]
  for (const name of packageProofs) {
    expect(suites.steps.find((step: any) => step.name === name).if).toBe(
      "matrix.suite == 'package-lifecycle'",
    )
  }
  for (const name of [
    'Prove complete packed CLI composition',
    'Run Operational Baseline/1 against the packed archive',
    'Attack the packed CLI inside the proved envelope',
  ]) {
    expect(suites.steps.find((step: any) => step.name === name).if).toBe(
      "matrix.suite == 'installed-evidence'",
    )
  }
  const workspace = suites.steps.find(
    (step: any) => step.name === 'Prove installed workspace dependency admission and execution',
  )
  const patterns = [dependencyReuse, workspace].map(
    (step) => new RegExp(step.run.match(/-t '([^']+)'/)[1]),
  )
  for (const name of [
    'packed project dependencies uses fresh reviewed data and immutable execution',
    'packed project entrypoint uses fresh reviewed data and immutable execution',
    'packed read attachments preserve empty roots and maximum relative paths',
    ...['member', 'root', 'nested'].map(
      (location) =>
        `installed CLI reviews and runs a workspace dependency (application: ${location})`,
    ),
    'a future package provider case',
    'a future case mentioning packed project dependencies in its title',
  ]) {
    expect(
      patterns.filter((pattern) => pattern.test(name)),
      name,
    ).toHaveLength(1)
  }
  expect(
    suites.steps.find((step: any) => step.name === 'Verify the tested archives are unchanged').if,
  ).toBe('always()')
  expect(suites.steps.find((step: any) => step.name === 'Require zero host residue').if).toContain(
    'always()',
  )
  expect(aggregate.name).toBe('rootless-linux')
  expect(aggregate.if).toBe('always()')
  expect(aggregate.needs).toEqual(['host-artifacts', 'host-suite'])
  expect(workflowTriggers(workflow).workflow_dispatch?.inputs?.qualify_codex_api).toBeUndefined()
  expect(aggregate.steps[0].run).toContain('!= success')
  for (const key of ['ARTIFACT_RESULT', 'SUITE_RESULT']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const child = spawnSync('/bin/sh', ['-c', aggregate.steps[0].run], {
        env: { ARTIFACT_RESULT: 'success', SUITE_RESULT: 'success', [key]: result },
      })
      expect(child.status).toBe(result === 'success' ? 0 : 1)
    }
  }
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
  const trigger = workflowTriggers(live).workflow_run
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
  expect(workflowTriggers(live).workflow_dispatch).toBeNull()
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

test('Mac publication gate accepts only a successful exact main-push host run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-host-gate-'))
  const bin = join(directory, 'bin')
  const revision = 'a'.repeat(40)
  const script = join(root, 'scripts/require-macos-host-conformance.sh')
  try {
    await mkdir(bin)
    await writeFile(join(bin, 'gh'), '#!/bin/sh\ncat "$MOCK_GH_RESPONSE"\n')
    await writeFile(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n')
    await chmod(join(bin, 'gh'), 0o755)
    await chmod(join(bin, 'sleep'), 0o755)
    const response = join(directory, 'response.json')
    const run = async (value: unknown) => {
      await writeFile(
        response,
        JSON.stringify({ workflow_runs: Array.isArray(value) ? value : [value] }),
      )
      const child = Bun.spawn(['/bin/sh', script, 'jiggy/jig', revision], {
        cwd: directory,
        env: {
          ...process.env,
          GH_TOKEN: 'fixture-token',
          MOCK_GH_RESPONSE: response,
          PATH: `${bin}:${process.env.PATH}`,
          TMPDIR: directory,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return { exit: await child.exited, output: await new Response(child.stdout).text() }
    }
    const matching = {
      status: 'completed',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: revision,
      head_repository: { full_name: 'jiggy/jig' },
    }
    expect((await run(matching)).exit).toBe(0)
    expect((await run({ ...matching, conclusion: 'failure' })).exit).toBe(1)
    expect(
      (
        await run([
          { ...matching, head_sha: 'b'.repeat(40) },
          { ...matching, conclusion: 'failure' },
        ])
      ).exit,
    ).toBe(1)
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

import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
// Bun 1.3 parses YAML's unquoted `on` as a boolean; Bun 1.4 preserves its name.
const workflowTriggers = (workflow: any) => workflow.on ?? workflow.true

// Execute the workflow's real source-derived planner against a small committed
// role tree. An editable checkout or a canned command list cannot prove that
// the aggregate and source shards agree on their exact pinned inventory.
async function linuxCommandFixture(workflow: any) {
  const directory = await mkdtemp(join(tmpdir(), 'linux-command-plan-'))
  const files = [
    'packages/jig/test/linux-host/linux-rootless-delegation-hostile.test.ts',
    'packages/jig/test/linux/linux-rootless-run.test.ts',
    'packages/jig/test/host/root-agent-composition.test.ts',
    'packages/jig/test/host/installed-software-factory.test.ts',
    'packages/jig/test/host/package-provider-observation.test.ts',
    'packages/jig/test/host/markdown-worker.test.ts',
    'packages/display-model/test/one.test.ts',
    'packages/display-web/test/one.test.ts',
    'packages/display-tui/test/one.test.ts',
  ]
  try {
    for (const file of files) {
      await mkdir(join(directory, file, '..'), { recursive: true })
      await writeFile(join(directory, file), '// Source inventory fixture.\n')
    }
    await mkdir(join(directory, 'scripts/ci'), { recursive: true })
    for (const file of ['suite-inventory.mjs', 'affected-manifest.json'])
      await copyFile(join(root, 'scripts/ci', file), join(directory, 'scripts/ci', file))
    for (const args of [
      ['init', '--quiet'],
      ['add', '.'],
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'Pinned Linux command fixture',
      ],
    ]) {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    }
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' })
    expect(revision.status, revision.stderr).toBe(0)
    const sha = revision.stdout.trim()
    const node = Bun.which('node')
    if (!node) throw new Error('Linux workflow fixture requires genuine Node')
    const planned = spawnSync(
      node,
      ['--input-type=module', '-e', workflow.env.LINUX_COMMAND_PLANNER],
      {
        cwd: directory,
        env: { ...process.env, GITHUB_SHA: sha },
        encoding: 'utf8',
      },
    )
    expect(planned.status, planned.stderr).toBe(0)
    return { directory, sha, files: files.sort(), commands: JSON.parse(planned.stdout) }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
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
      ['1', '0', 1, 'Install Python release tools'],
      ['0', '1', 1, 'Install protocol fixtures'],
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

test('PRs plan work before allocation and keep quick checks independent of candidate qualification', async () => {
  const load = async (file: string) =>
    Bun.YAML.parse(await Bun.file(join(root, '.github/workflows', file)).text()) as any
  const mac = await load('macos-hosted-candidates.yml')
  const ci = await load('ci.yml')
  expect(Object.hasOwn(workflowTriggers(mac), 'pull_request')).toBeTrue()
  expect(workflowTriggers(mac).pull_request?.paths).toBeUndefined()
  expect(workflowTriggers(ci).pull_request?.paths).toBeUndefined()
  for (const workflow of [ci, mac]) {
    expect(workflow.jobs.plan).toBeDefined()
    const planner = workflow.jobs.plan.steps.find((step: any) =>
      step.run?.includes('affected-plan.mjs'),
    )
    expect(planner.env.MODE).toContain("|| 'shadow'")
    expect(planner.run).toContain('--base')
    expect(planner.run).toContain('--head')
    expect(
      workflow.jobs.plan.steps.find((step: any) => step.uses?.startsWith('actions/checkout')).with[
        'fetch-depth'
      ],
    ).toBe(0)
  }
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
    mac.jobs.prerequisites.steps.find((s: any) =>
      s.run?.includes('scripts/ci/install-macos-test-clients.ts'),
    ).if,
  ).toBe('matrix.installed')
  expect(mac.concurrency['cancel-in-progress']).toContain("github.ref != 'refs/heads/main'")
  expect(ci.jobs['quick-checks'].needs).toBe('plan')
  expect(ci.jobs['sites'].needs).toBe('plan')
  expect(ci.jobs['candidate-build'].needs).toBe('plan')
  expect(ci.jobs['npm-candidate'].needs).toEqual(['plan', 'candidate-build'])
  expect(ci.jobs['npm-candidate'].strategy.matrix).toContain('needs.plan.outputs.npm_matrix')
  expect(
    ci.jobs['quick-checks'].steps.some((step: any) => step.run?.includes('just test-tooling')),
  ).toBeTrue()
  const producer = ci.jobs['candidate-build']
  expect(producer.steps.some((step: any) => step.run?.includes('build-candidates.mjs'))).toBeTrue()
  expect(
    producer.steps.some((step: any) => step.run?.includes('qualify-candidate.mjs')),
  ).toBeFalse()
  expect(
    producer.steps.find((step: any) => step.uses?.startsWith('actions/upload-artifact')).with.name,
  ).toContain('${{ github.run_attempt }}')
  expect(
    ci.jobs['npm-candidate'].steps.some((step: any) => step.run?.includes('qualify-candidate.mjs')),
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
  expect(new Set(ci.jobs.test.needs)).toEqual(
    new Set([
      'plan',
      'quick-checks',
      'sites',
      'source-tests',
      'candidate-build',
      'python-build',
      'python-installed',
      'npm-candidate',
    ]),
  )
  const aggregate = ci.jobs.test.steps.find((step: any) => step.run?.includes('affected-gate.mjs'))
  expect(aggregate.env.JOB_RESULTS).toBe('${{ toJSON(needs) }}')
  expect(aggregate.run).toContain('job-evidence.mjs')
  expect(aggregate.run).toContain('--scope ci')
  for (const id of ['quick-checks', 'source-tests', 'python-installed', 'npm-candidate']) {
    expect(ci.jobs[id].steps.some((step: any) => step.run?.includes('job-evidence.mjs'))).toBeTrue()
  }
  const sourceInputs = ci.jobs['source-tests'].steps.find((step: any) =>
    step.run?.includes('candidate-transfer.mjs'),
  )
  expect(sourceInputs.run).toContain('--producer-run "$GITHUB_RUN_ID"')
  expect(sourceInputs.run).toContain('CI_CANDIDATE_BUNDLE')
  const source = ci.jobs['source-tests']
  expect(source.if).toContain("needs.python-build.result == 'skipped'")
  expect(ci.jobs.plan.outputs.source_targets).toContain('steps.plan.outputs.source_targets')
  for (const name of ['source_portable', 'source_protocol', 'source_applications', 'source_python'])
    expect(ci.jobs.plan.outputs[name]).toContain(`steps.plan.outputs.${name}`)
  const execute = source.steps.find((step: any) => step.run?.includes('scripts/test-release.sh'))
  expect(execute.run).toContain('--targets "$JIG_CI_SOURCE_TARGETS" --profile portable-linux')
  expect(execute.env.JIG_CI_SOURCE_REPORT_DIRECTORY).toContain('/source-reports')
  for (const step of source.steps.filter((step: any) => step.with?.name?.startsWith('python-')))
    expect(step.if).toContain("source_python == 'true'")
  expect(
    source.steps.find((step: any) => step.name === 'Record each selected source stage').run,
  ).toContain('writeJobEvidence')
  expect(aggregate.run).toContain('target.selected?n["source-tests"].result:"skipped"')
})

test('the actual source evidence program records only selected stage reports and the aggregate maps job outcomes', async () => {
  const ci = Bun.YAML.parse(await Bun.file(join(root, '.github/workflows/ci.yml')).text()) as any
  const directory = await mkdtemp(join(tmpdir(), 'source-stage-recording-'))
  try {
    await mkdir(join(directory, 'plan'))
    await mkdir(join(directory, 'source-reports'))
    const stages = ['source-portable', 'source-protocol', 'source-applications', 'source-python']
    const pythonFiles = [
      'sdk/test_a.py',
      'sdk/test_b.py',
      'updates/test_c.py',
      'scripts/test_release.py',
    ]
    const targets = stages.map((id) => ({
      id,
      selected: id === 'source-portable' || id === 'source-python',
      runtimeProfiles: ['source-profile'],
      testInventory:
        id === 'source-python' ? pythonFiles : ['packages/jig/test/portable/example.test.ts'],
      inventoryDigest: 'inventory',
    }))
    await Bun.write(
      join(directory, 'plan/plan.json'),
      JSON.stringify({ identity: { head: 'a'.repeat(40) }, planDigest: 'plan', targets }),
    )
    await Bun.write(
      join(directory, 'source-reports/source-portable.xml'),
      '<testsuites tests="1"><testcase file="packages/jig/test/portable/example.test.ts" classname="suite" name="executed"/></testsuites>',
    )
    await Bun.write(
      join(directory, 'source-reports/source-python.txt'),
      pythonFiles
        .map((file) => `Ran 1 test in 0.01s\n\nOK\nCI Python source file complete: ${file}\n`)
        .join(''),
    )
    const writer = ci.jobs['source-tests'].steps.find(
      (step: any) => step.name === 'Record each selected source stage',
    )
    const execute = spawnSync('/bin/bash', ['-c', writer.run], {
      cwd: root,
      env: { ...process.env, RUNNER_TEMP: directory },
      encoding: 'utf8',
    })
    expect(execute.status, execute.stderr).toBe(0)
    expect((await readdir(join(directory, 'source-evidence'))).sort()).toEqual([
      'source-portable.json',
      'source-python.json',
    ])
    for (const id of ['source-portable', 'source-python']) {
      const receipt = await Bun.file(join(directory, 'source-evidence', `${id}.json`)).json()
      expect(receipt.results[0].id).toBe(id)
      expect(receipt.results[0].observedSkipped).toBe(0)
      expect(receipt.results[0].executedCount).toBe(id === 'source-python' ? 4 : 1)
    }
    const aggregate = ci.jobs.test.steps.find((step: any) =>
      step.run?.includes('affected-gate.mjs'),
    )
    const program = aggregate.run
      .split('\n')
      .find((line: string) => line.includes('JSON.parse(process.env.JOB_RESULTS)'))
    for (const result of ['success', 'failure', 'cancelled']) {
      const mapped = spawnSync('/bin/bash', ['-c', program], {
        cwd: root,
        env: {
          ...process.env,
          RUNNER_TEMP: directory,
          JOB_RESULTS: JSON.stringify({
            plan: { result: 'success' },
            'candidate-build': { result: 'skipped' },
            'source-tests': { result },
          }),
        },
        encoding: 'utf8',
      })
      expect(mapped.status, mapped.stderr).toBe(0)
      const actual = await Bun.file(join(directory, 'results.json')).json()
      for (const target of targets)
        expect(actual[target.id]).toBe(target.selected ? result : 'skipped')
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
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

test('installed npm qualification builds the source workspace only for Jig', async () => {
  const ci = Bun.YAML.parse(await Bun.file(join(root, '.github/workflows/ci.yml')).text()) as any
  const steps = ci.jobs['npm-candidate'].steps
  const dependencies = steps.find(
    (step: any) => step.name === 'Install candidate qualification dependencies',
  )
  const build = steps.find((step: any) => step.name === 'Build Jig source-test workspace')
  expect(dependencies.if).toBeUndefined()
  expect(dependencies.run).toBe('bun install --ignore-scripts')
  expect(build.if).toBe("${{ matrix.package == 'jig' }}")
  expect(build.run).toBe('just jig::build')
  const setup = steps.filter((step: any) =>
    /\bbun install\b|\bjust jig::build\b/.test(step.run ?? ''),
  )
  expect(setup).toEqual([dependencies, build])
  const directory = await mkdtemp(join(tmpdir(), 'candidate-setup-'))
  try {
    const bin = join(directory, 'bin')
    await mkdir(bin)
    for (const name of ['bun', 'just']) {
      const executable = join(bin, name)
      await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "$SETUP_CALLS"\n`)
      await chmod(executable, 0o755)
    }
    for (const kind of ['flow', 'agent', 'acp', 'jig']) {
      const calls = join(directory, `${kind}.txt`)
      const selected = setup.filter((step: any) => !step.if || kind === 'jig')
      const result = spawnSync(
        '/bin/bash',
        ['-eu', '-c', selected.map((step: any) => step.run).join('\n')],
        {
          cwd: directory,
          env: { PATH: `${bin}:/usr/bin:/bin`, SETUP_CALLS: calls },
          encoding: 'utf8',
          timeout: 5000,
        },
      )
      expect(result.status, result.stderr).toBe(0)
      expect(await readFile(calls, 'utf8')).toBe(
        kind === 'jig'
          ? 'bun install --ignore-scripts\njust jig::build\n'
          : 'bun install --ignore-scripts\n',
      )
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
  expect(candidate.strategy.matrix).toContain('needs.plan.outputs.npm_matrix')
  expect(ci.permissions).toEqual({ contents: 'read' })
  expect(publish.permissions).toEqual({ actions: 'read', 'id-token': 'write' })
  expect(publish.needs).toContain('authorize')
  expect(authorize.name).toContain('same-revision')
  expect(publish.steps.some((step: any) => step.uses?.startsWith('actions/checkout'))).toBeFalse()
  const download = publish.steps.find(
    (step: any) => step.name === 'Download exact persisted candidates',
  )
  expect(download.with['artifact-ids']).toContain('needs.authorize.outputs.')
  expect(download.with['run-id']).toContain('needs.authorize.outputs.')
  expect(download.with['github-token']).toBe('${{ github.token }}')
  const script = publish.steps.find((step: any) => step.id === 'release').run
  expect(publish.env.RELEASE_GROUP).toBe('host')
  expect(script).toContain('host) package_kinds="agent acp jig"')
  expect(script).toContain('for PREFLIGHT in true false; do')
  expect(script).toContain('registry bytes differ')
  expect(script).toContain('success.commit !== process.env.SOURCE_REVISION')
  expect(authorize['timeout-minutes']).toBeLessThanOrEqual(5)
  expect(
    authorize.steps.some((step: any) => step.run?.includes('release-readiness.mjs')),
  ).toBeTrue()
  expect(
    authorize.steps.some((step: any) => step.run?.includes('require-macos-host-conformance.sh')),
  ).toBeFalse()
  expect(workflowTriggers(workflow).workflow_run.workflows).toContain(
    'Native Agent API qualification',
  )
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
    ci.jobs['python-build'].steps.some(
      (step: any) =>
        step.run?.includes('build-python-sdk.py') && step.run.includes('--candidate --build-only'),
    ),
  ).toBeTrue()
  expect(ci.jobs['python-installed'].needs).toContain('python-build')
  expect(workflow.jobs.build).toBeUndefined()
  expect(workflow.jobs.qualify).toBeUndefined()
  expect(workflow.jobs.prepare.needs).toBe('authorize')
  for (const job of [workflow.jobs.prepare, workflow.jobs.verify]) {
    const download = job.steps.find((step: any) =>
      step.uses?.startsWith('actions/download-artifact'),
    )
    expect(download.with['artifact-ids']).toBe(
      '${{ needs.authorize.outputs.candidate_artifact_id }}',
    )
    expect(download.with.name).toBeUndefined()
    expect(download.with['merge-multiple']).toBeTrue()
    expect(download.with['run-id']).toBe('${{ github.event.workflow_run.id }}')
    expect(download.with['github-token']).toBe('${{ github.token }}')
  }
  for (const id of ['python-build', 'python-installed', 'source-tests']) {
    const candidates = ci.jobs[id].steps.filter((step: any) =>
      step.with?.name?.startsWith('python-'),
    )
    expect(candidates).toHaveLength(2)
    for (const step of candidates) {
      expect(step.with.name).toContain('-r${{ github.run_id }}-a${{ github.run_attempt }}')
    }
  }
})

test('Linux full and compact routes preserve distinct qualification obligations', async () => {
  const workflow = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/linux-host-conformance.yml')).text(),
  ) as any
  const artifacts = workflow.jobs['host-artifacts']
  const suites = workflow.jobs['host-suite']
  const aggregate = workflow.jobs['rootless-linux']
  const witness = workflow.jobs['linux-witness']
  expect(workflowTriggers(workflow).pull_request?.paths).toBeUndefined()
  expect(artifacts.if).toContain("needs.plan.outputs.linux == 'true'")
  expect(artifacts.if).toContain("needs.plan.outputs.linux_witness == 'true'")
  expect(suites.if).toBe("${{ needs.plan.outputs.linux == 'true' }}")
  expect(suites.needs).toContain('host-artifacts')
  expect(
    artifacts.steps.some((step: any) => step.run?.includes('candidate-transfer.mjs')),
  ).toBeTrue()
  expect(artifacts.steps.some((step: any) => step.run?.includes('scripts/pack.ts'))).toBeFalse()
  expect(suites.strategy['fail-fast']).toBeFalse()
  expect(suites.strategy.matrix.suite).toEqual([
    'agent-lifecycle',
    'delegated-authority',
    'package-lifecycle',
    'installed-evidence',
  ])
  const source = suites.steps.find(
    (step: any) => step.name === 'Execute every pinned whole-file source group exactly once',
  )
  expect(source.if).toBe("matrix.suite != 'installed-evidence'")
  expect(source.run).toContain('node --input-type=module -e "$LINUX_COMMAND_PLANNER"')
  expect(source.run).toContain('"$JIG_CI_BUN" test "$file" --timeout "$timeout_ms"')
  expect(source.run).toContain('read -r -d')
  expect(source.run).not.toContain(' -t ')
  expect(source.run).not.toContain('testNamePattern')
  expect(workflow.env.LINUX_COMMAND_PLANNER).toContain('gitRepositoryTests(process.cwd(), source)')
  const archiveVariables = [
    'JIG_PACKAGE_ARCHIVE',
    'FLOW_SDK_PACKAGE_ARCHIVE',
    'USER_UPDATES_PACKAGE_ARCHIVE',
    'AGENT_METHOD_PACKAGE_ARCHIVE',
    'AGENT_ACP_PACKAGE_ARCHIVE',
    'DISPLAY_MODEL_PACKAGE_ARCHIVE',
    'DISPLAY_WEB_PACKAGE_ARCHIVE',
    'DISPLAY_TUI_PACKAGE_ARCHIVE',
  ]
  const installed = suites.steps.filter((step: any) => step.env?.JIG_CI_COMMAND_CONTEXT)
  expect(installed).toHaveLength(6)
  for (const step of [source, ...installed]) {
    if (step.name?.startsWith('Qualify standalone ')) {
      expect(step.run).toContain('FLOW_NODE=$(command -v node)')
    } else {
      for (const variable of archiveVariables)
        expect(step.run).toContain(`"${variable}=$${variable}"`)
    }
    expect(step.run).toContain('set -euo pipefail')
    if (step !== source) {
      expect(step.if).toBe("matrix.suite == 'installed-evidence'")
      expect(JSON.parse(step.env.JIG_CI_COMMAND_CONTEXT).commandKind).toBe('installed-script')
      expect(step.run).toContain('CI installed script complete: %s')
    }
  }
  const identifyArchives = suites.steps.find(
    (step: any) => step.name === 'Identify and verify the frozen archives',
  )
  for (const variable of archiveVariables)
    expect(identifyArchives.run).toContain(`printf '${variable}=%s`)
  expect(
    installed.map((step: any) => JSON.parse(step.env.JIG_CI_COMMAND_CONTEXT).files[0]),
  ).toEqual([
    'packages/jig/test/package-smoke.ts',
    'scripts/test-operational-baseline.ts',
    'scripts/test-installed-hostile-baseline.ts',
    'packages/display-model/test/package-smoke.ts',
    'packages/display-web/test/package-smoke.ts',
    'packages/display-tui/test/package-smoke.ts',
  ])
  expect(
    suites.steps.find((step: any) => step.name === 'Verify the tested archives are unchanged').if,
  ).toBe('always()')
  expect(suites.steps.find((step: any) => step.name === 'Require zero host residue').if).toContain(
    'always()',
  )
  expect(aggregate.name).toBe('rootless-linux')
  expect(aggregate.if).toContain('always()')
  expect(aggregate.if).toContain('needs.plan.outputs.linux')
  expect(aggregate.needs).toContain('host-artifacts')
  expect(aggregate.needs).toContain('host-suite')
  const shardGate = aggregate.steps.find((step: any) => step.env?.ARTIFACT_RESULT !== undefined)
  for (const key of ['ARTIFACT_RESULT', 'SUITE_RESULT']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const child = spawnSync('/bin/sh', ['-c', shardGate.run], {
        env: { ARTIFACT_RESULT: 'success', SUITE_RESULT: 'success', [key]: result },
      })
      expect(child.status).toBe(result === 'success' ? 0 : 1)
    }
  }
  const proof = aggregate.steps.find(
    (step: any) => step.name === 'Require exact complete shard evidence and retain observed cases',
  )
  expect(proof.run).toContain('os.environ["LINUX_COMMAND_PLANNER"]')
  expect(proof.run.indexOf('job-evidence.mjs')).toBeLessThan(
    proof.run.indexOf('candidate-provenance.mjs qualification'),
  )
  expect(witness.if).toBe("${{ needs.plan.outputs.linux_witness == 'true' }}")
  expect(witness.steps.some((step: any) => step.run?.includes('just --justfile'))).toBeFalse()
  const witnessRuns = witness.steps.map((step: any) => step.run ?? '').join('\n')
  expect(witnessRuns).toContain('packages/jig/test/host/package-provider-observation.test.ts')
  expect(witnessRuns).toContain('packages/jig/test/installed-display-smoke.ts')
  expect(witnessRuns).toContain('--junit')
  expect(witnessRuns).toContain('--transcript-manifest')
  expect(witnessRuns).toContain('--id linux-witness')
  expect(witnessRuns).not.toContain('candidate-provenance.mjs qualification')
  expect(witnessRuns).not.toContain('QUALIFICATION.json')
  const affected = workflow.jobs['affected-linux']
  expect(affected.needs).toContain('linux-witness')
  expect(affected.steps.some((step: any) => step.run?.includes('--scope linux'))).toBeTrue()
  const fixture = await linuxCommandFixture(workflow)
  try {
    const sourceCommands = ['agent-lifecycle', 'delegated-authority', 'package-lifecycle'].flatMap(
      (suite) => fixture.commands[suite],
    )
    expect(sourceCommands.map((command: any) => command.files[0]).sort()).toEqual(fixture.files)
    expect(new Set(sourceCommands.map((command: any) => command.files[0])).size).toBe(
      fixture.files.length,
    )
    expect(
      sourceCommands.every((command: any) => command.files.length === 1 && !command.filter),
    ).toBeTrue()
    for (const [index, file] of fixture.files.entries()) {
      const suite = ['agent-lifecycle', 'delegated-authority', 'package-lifecycle'][index % 3]
      expect(fixture.commands[suite].some((command: any) => command.files[0] === file)).toBeTrue()
    }
    expect(
      sourceCommands.find((command: any) =>
        command.files[0].endsWith('installed-software-factory.test.ts'),
      ).hostMode,
    ).toBe('run-acquisition-host')
    expect(
      sourceCommands.find((command: any) =>
        command.files[0].endsWith('root-agent-composition.test.ts'),
      ).hostMode,
    ).toBe('run-delegated')
    expect(fixture.commands['installed-evidence']).toEqual(
      installed.map((step: any) => JSON.parse(step.env.JIG_CI_COMMAND_CONTEXT)),
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

const linuxAggregateScenarios = [
  {
    name: 'accepts every whole file and all six installed obligations',
    kind: 'complete',
    command: undefined,
  },
  ...[12, 13, 14, 16, 17, 18].map((index) => ({
    name: `refuses missing installed-evidence command ${index}`,
    kind: 'missing',
    command: `command-${index}.txt`,
  })),
  { name: 'refuses a missing whole-file command', kind: 'source-missing', command: undefined },
  {
    name: 'refuses changed whole-file authority metadata',
    kind: 'source-drift',
    command: undefined,
  },
  { name: 'refuses an old filtered command manifest', kind: 'legacy', command: undefined },
  { name: 'refuses a stale-attempt shard', kind: 'stale', command: undefined },
  { name: 'refuses different candidate bytes', kind: 'candidate', command: undefined },
]
for (const scenario of linuxAggregateScenarios) {
  test(`Linux aggregate ${scenario.name}`, async () => {
    const workflow = Bun.YAML.parse(
      await Bun.file(join(root, '.github/workflows/linux-host-conformance.yml')).text(),
    ) as any
    const suites = workflow.jobs['host-suite']
    const record = suites.steps.find((step: any) => step.name === 'Record complete shard proof').run
    const proof = workflow.jobs['rootless-linux'].steps.find(
      (step: any) =>
        step.name === 'Require exact complete shard evidence and retain observed cases',
    )
    const script = proof.run.split('\nmkdir "$RUNNER_TEMP/linux-qualification"')[0]
    const fixture = await linuxCommandFixture(workflow)
    const { directory, sha, commands } = fixture
    const env = {
      ...process.env,
      RUNNER_TEMP: directory,
      GITHUB_SHA: sha,
      GITHUB_RUN_ID: '41',
      GITHUB_RUN_ATTEMPT: '2',
      LINUX_COMMAND_PLANNER: workflow.env.LINUX_COMMAND_PLANNER,
    }
    const shardDirectory = (suite: string) =>
      join(directory, 'linux-evidence', `linux-shard-${suite}-${sha}-r41-a2`)
    try {
      await mkdir(join(directory, 'linux-host-artifacts'))
      for (const filename of ['CANDIDATE.json', 'ARTIFACT.json'])
        await writeFile(join(directory, 'linux-host-artifacts', filename), filename)
      for (const suite of suites.strategy.matrix.suite) {
        const shard = shardDirectory(suite)
        await mkdir(join(shard, 'linux-command-evidence'), { recursive: true })
        const marker = spawnSync('/bin/bash', ['-c', record], {
          env: { ...env, RUNNER_TEMP: shard, SUITE: suite },
          encoding: 'utf8',
        })
        expect(marker.status, marker.stderr).toBe(0)
        expect(await Bun.file(join(shard, 'linux-shard.complete')).text()).toBe(
          `${sha} ${suite} 41 2\n`,
        )
        for (const filename of ['CANDIDATE.json', 'ARTIFACT.json'])
          await copyFile(join(directory, 'linux-host-artifacts', filename), join(shard, filename))
        await writeFile(
          join(shard, 'linux-command-evidence/manifest.json'),
          JSON.stringify({ schemaVersion: 1, commands: commands[suite] }),
        )
        for (const command of commands[suite])
          await writeFile(
            join(shard, 'linux-command-evidence', command.transcript),
            'Owning transcript retained.\n',
          )
      }
      if (scenario.command) {
        await writeFile(
          join(shardDirectory('installed-evidence'), 'linux-command-evidence/manifest.json'),
          JSON.stringify({
            schemaVersion: 1,
            commands: commands['installed-evidence'].filter(
              (command: any) => command.transcript !== scenario.command,
            ),
          }),
        )
      } else if (['source-missing', 'source-drift', 'legacy'].includes(scenario.kind)) {
        const changed = structuredClone(commands['agent-lifecycle'])
        if (scenario.kind === 'source-missing') changed.pop()
        if (scenario.kind === 'source-drift') changed[0].hostMode = 'run-acquisition-host'
        if (scenario.kind === 'legacy')
          changed[0] = {
            transcript: 'command-0.txt',
            files: ['packages/jig/test/package-provider-host.test.ts'],
            filter: {
              pattern: '^packed project dependencies ',
              files: ['packages/jig/test/package-provider-host.test.ts'],
            },
          }
        await writeFile(
          join(shardDirectory('agent-lifecycle'), 'linux-command-evidence/manifest.json'),
          JSON.stringify({ schemaVersion: 1, commands: changed }),
        )
      } else if (scenario.kind === 'stale') {
        await writeFile(
          join(shardDirectory('agent-lifecycle'), 'linux-shard.complete'),
          `${sha} agent-lifecycle 41 1\n`,
        )
      } else if (scenario.kind === 'candidate') {
        await writeFile(
          join(shardDirectory('package-lifecycle'), 'CANDIDATE.json'),
          'different candidate',
        )
      }
      const result = spawnSync('/bin/bash', ['-c', script], {
        cwd: directory,
        env,
        encoding: 'utf8',
      })
      expect(result.status, result.stderr).toBe(scenario.kind === 'complete' ? 0 : 1)
      const combined = join(directory, 'linux-evidence/manifest.json')
      if (scenario.kind === 'complete') {
        const manifest = await Bun.file(combined).json()
        expect(manifest.commands).toHaveLength(fixture.files.length + 6)
        expect(manifest.commands.map((command: any) => command.files[0]).sort()).toEqual(
          Object.values(commands)
            .flat()
            .map((command: any) => command.files[0])
            .sort(),
        )
      } else expect(await Bun.file(combined).exists()).toBeFalse()
      expect(
        await Bun.file(join(directory, 'linux-qualification/QUALIFICATION.json')).exists(),
      ).toBeFalse()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

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
  const publishAuthorization = publish.jobs.authorize

  expect(host.jobs['rootless-linux'].needs).toContain('host-artifacts')
  expect(host.jobs['rootless-linux'].needs).toContain('host-suite')
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
  expect(matrix.map((entry: any) => entry['test-file'])).toEqual([
    'packages/jig/test/live/root-agent-codex-responses.test.ts',
    'packages/jig/test/live/root-agent-claude.test.ts',
    'packages/jig/test/live/root-agent-pi.test.ts',
  ])
  expect(apiSteps[0].env.JIG_NATIVE_API_TEST_FILE).toBe('${{ matrix.test-file }}')
  expect(apiSteps[0].run).toContain('test "$JIG_NATIVE_API_TEST_FILE"')
  expect(apiSteps[0].run).toContain('parseBunTranscript')
  expect(apiSteps[0].run).not.toContain('--test-name-pattern')
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
  const hostRun = qualification.steps.find((step: any) => step.id === 'host-run')
  expect(hostRun.env.GH_TOKEN).toBe('${{ github.token }}')
  expect(hostRun.run).toContain('acquire-linux')
  expect(hostRun.run).toContain('--source "$SOURCE_REVISION"')
  expect(hostRun.run).toContain('--qualification-output')
  expect(hostRun.run).toContain('--linux-run "$TRIGGER_RUN_ID"')
  const receipt = qualification.steps.find((step: any) =>
    step.run?.includes('candidate-provenance.mjs qualification'),
  )
  expect(receipt.run).toContain('--kind native')
  expect(receipt.run).toContain('--upstream-receipt')
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
  expect(publishAuthorization['timeout-minutes']).toBeLessThanOrEqual(5)
  expect(
    publishAuthorization.steps.some((step: any) => step.run?.includes('release-readiness.mjs')),
  ).toBeTrue()
  expect(pypi.includes('require-native-agent-api-qualification.sh')).toBeFalse()
})

test('native acquisition passes exact source and optional upstream run, and preserves refusal', async () => {
  const live = Bun.YAML.parse(
    await Bun.file(join(root, '.github/workflows/native-agent-api-qualification.yml')).text(),
  ) as any
  const script = live.jobs.qualification.steps.find((step: any) => step.id === 'host-run').run
  const directory = await mkdtemp(join(tmpdir(), 'native-agent-acquisition-'))
  const bin = join(directory, 'bin')
  const calls = join(directory, 'calls')
  const output = join(directory, 'output')
  const revision = 'a'.repeat(40)
  try {
    await mkdir(bin)
    await writeFile(
      join(bin, 'node'),
      '#!/bin/sh\nset -eu\nprintf \'%s\\n\' "$@" > "$MOCK_NODE_CALLS"\nexit "$MOCK_NODE_STATUS"\n',
    )
    await chmod(join(bin, 'node'), 0o755)
    const run = async (trigger = '', status = '0') => {
      const child = Bun.spawn(['/bin/bash', '-e', '-c', script], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MOCK_NODE_CALLS: calls,
          MOCK_NODE_STATUS: status,
          GITHUB_OUTPUT: output,
          RUNNER_TEMP: directory,
          SOURCE_REVISION: revision,
          TRIGGER_RUN_ID: trigger,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const stdout = new Response(child.stdout).text()
      const stderr = new Response(child.stderr).text()
      return {
        exit: await child.exited,
        stdout: await stdout,
        stderr: await stderr,
        arguments: (await Bun.file(calls).text()).trimEnd().split('\n'),
      }
    }
    const expected = [
      'scripts/ci/candidate-transfer.mjs',
      'acquire-linux',
      join(directory, 'linux-host-artifacts'),
      '--source',
      revision,
      '--qualification-output',
      join(directory, 'linux-qualification'),
      '--github-output',
      output,
    ]
    const manual = await run()
    expect(manual.exit).toBe(0)
    expect(manual.arguments).toEqual(expected)
    const automatic = await run('91')
    expect(automatic.exit).toBe(0)
    expect(automatic.arguments).toEqual([...expected, '--linux-run', '91'])
    const refused = await run('91', '47')
    expect(refused.exit).toBe(47)
    expect(refused.arguments).toEqual(automatic.arguments)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Mac qualification copies the supplied candidate bytes and refuses archive drift without repacking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mac-frozen-candidate-'))
  const repository = join(directory, 'source')
  const canonical = join(directory, 'canonical')
  const bin = join(directory, 'bin')
  const log = join(directory, 'bun-calls')
  const shardLog = join(directory, 'shard-calls')
  const node = Bun.which('node')
  if (!node) throw new Error('candidate orchestration requires genuine Node')
  const execute = (command: string, args: string[], cwd = repository) => {
    const result = spawnSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
    })
    if (result.status !== 0)
      throw Error(result.stderr || result.error?.message || 'fixture command failed')
    return result.stdout.trim()
  }
  try {
    await mkdir(join(repository, 'scripts/ci'), { recursive: true })
    await mkdir(canonical)
    await mkdir(bin)
    await mkdir(join(directory, 'scratch'))
    for (const name of ['qualify-macos-host.sh', 'candidate-provenance.mjs']) {
      await copyFile(join(root, 'scripts/ci', name), join(repository, 'scripts/ci', name))
    }
    await writeFile(
      join(repository, 'scripts/ci/macos-host-test-shards.mjs'),
      `
      import { appendFileSync, readFileSync } from 'node:fs'
      import { join } from 'node:path'
      if (process.argv[2] === 'count') console.log(3)
      else if (process.argv[2] === 'run') {
        const inputs = Object.entries({ 'flow-sdk':'FLOW_SDK_PACKAGE_ARCHIVE', 'user-updates':'USER_UPDATES_PACKAGE_ARCHIVE', 'agent-method':'AGENT_METHOD_PACKAGE_ARCHIVE', 'agent-acp':'AGENT_ACP_PACKAGE_ARCHIVE', 'display-model':'DISPLAY_MODEL_PACKAGE_ARCHIVE', 'display-web':'DISPLAY_WEB_PACKAGE_ARCHIVE', 'display-tui':'DISPLAY_TUI_PACKAGE_ARCHIVE', jig:'JIG_PACKAGE_ARCHIVE' })
        for (const [kind, variable] of inputs) {
          const copied = process.env[variable]
          if (!copied || copied.startsWith(process.env.JIG_CI_CANDIDATE_DIRECTORY)) throw Error('consumer must receive an isolated frozen copy')
          if (!readFileSync(copied).equals(readFileSync(join(process.env.JIG_CI_CANDIDATE_DIRECTORY,kind,kind+'.tgz')))) throw Error('consumer received different bytes')
        }
        appendFileSync(process.env.MOCK_SHARD_LOG, 'qualified-copy\\n')
        if (process.env.MOCK_MUTATE === 'archive') appendFileSync(join(process.env.JIG_CI_CANDIDATE_DIRECTORY,'jig/jig.tgz'), 'changed')
      } else throw Error('unexpected shard invocation')
    `,
    )
    const tools = {
      uname: 'case "$1" in -s) echo Darwin;; -m) echo x86_64;; -r) echo 24.6.0;; *) exit 2;; esac',
      sw_vers: 'echo 24G830',
      launchctl: 'exit 0',
      mount: 'exit 0',
      ps: 'exit 0',
      bun: `printf '%s\\n' "$*" >> "$MOCK_BUN_LOG"
if [ "$1" = -e ]; then
  case "$2" in
    'console.log(process.arch)') echo x64;;
    *realpathSync*) exec "$MOCK_NODE" -e "$2" "$3";;
    *Bun.version*) exit 0;;
    *) exit 42;;
  esac
else exit 42; fi`,
    }
    for (const [name, body] of Object.entries(tools)) {
      await writeFile(join(bin, name), `#!/bin/sh\nset -eu\n${body}\n`)
      await chmod(join(bin, name), 0o755)
    }
    execute('git', ['init', '-q'])
    execute('git', ['add', 'scripts'])
    execute('git', [
      '-c',
      'user.name=Candidate fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'candidate fixture',
    ])
    const revision = execute('git', ['rev-parse', 'HEAD'])
    const { PACKAGE_LAYOUT, writeCandidateReceipt } = await import('./ci/candidate-provenance.mjs')
    for (const [kind, name] of Object.entries(PACKAGE_LAYOUT)) {
      const contents = join(directory, 'contents', kind)
      await mkdir(join(contents, 'package'), { recursive: true })
      await mkdir(join(canonical, kind))
      await writeFile(
        join(contents, 'package/package.json'),
        JSON.stringify({ name, version: '0.1.0-alpha.1' }),
      )
      const archive = join(canonical, kind, `${kind}.tgz`)
      execute('tar', ['-czf', archive, '-C', contents, 'package'])
      const bytes = await readFile(archive)
      await writeFile(
        `${archive}.sha256`,
        `${createHash('sha256').update(bytes).digest('hex')}  ${kind}.tgz\n`,
      )
      await writeFile(
        `${archive}.files`,
        `${execute('tar', ['-tzf', archive]).split('\n').sort().join('\n')}\n`,
      )
    }
    await mkdir(join(canonical, 'resolution'))
    await writeFile(join(canonical, 'resolution/bun.lock'), 'fixture dependency resolution')
    await writeCandidateReceipt({
      root: canonical,
      sourceRevision: revision,
      producer: {
        repository: 'local/local',
        workflowPath: '.github/workflows/ci.yml',
        runId: 0,
        runAttempt: 0,
        event: 'local',
        headSha: revision,
        headBranch: 'local',
        headRepository: 'local/local',
      },
      buildProfile: {
        version: '1.3.3',
        revision: '274e01c737e85f8142070a9745b43a2ba09fce4c',
        platform: 'linux',
        architecture: 'x64',
        nodeVersion: process.versions.node,
        npmVersion: '11.6.2',
        justVersion: 'just 1.43.1',
      },
      resolutionFiles: ['resolution/bun.lock'],
    })
    const run = (extra: Record<string, string> = {}) =>
      spawnSync('/bin/bash', ['scripts/ci/qualify-macos-host.sh', '--shard', '0'], {
        cwd: repository,
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          JIG_AUTHORING_NODE_PATH: node,
          JIG_CI_CANDIDATE_DIRECTORY: canonical,
          TMPDIR: join(directory, 'scratch'),
          MOCK_NODE: node,
          MOCK_BUN_LOG: log,
          MOCK_SHARD_LOG: shardLog,
          ...extra,
        },
      })
    const qualified = run()
    expect(qualified.status, qualified.stderr).toBe(0)
    expect(await Bun.file(shardLog).text()).toBe('qualified-copy\n')
    expect(await readdir(join(directory, 'scratch'))).toEqual([])
    const extraArchive = join(canonical, 'jig/extra.tgz')
    await copyFile(join(canonical, 'jig/jig.tgz'), extraArchive)
    const ambiguous = run()
    expect(ambiguous.status).toBe(1)
    expect(ambiguous.stderr).toContain('Expected one canonical jig archive')
    expect(await Bun.file(shardLog).text()).toBe('qualified-copy\n')
    await rm(extraArchive)
    const changed = run({ MOCK_MUTATE: 'archive' })
    expect(changed.status).toBe(1)
    expect(changed.stderr).toContain('The canonical candidate changed')
    expect(await Bun.file(log).text()).not.toContain('pm pack')
    expect(await Bun.file(log).text()).not.toContain('scripts/pack.ts')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

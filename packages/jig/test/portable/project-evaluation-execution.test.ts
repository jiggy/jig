import { describe, expect, test } from 'bun:test'
import evaluationContract from '../../../../docs/jig/spec/contracts/project-evaluation/contract.json' with {
  type: 'json',
}
import { privateLinuxEvaluationWorkspaceArguments } from '../../src/internal/linux-evaluation-workspace.js'
import { PROJECT_EVALUATION_CONTRACT_DIGEST } from '../../src/internal/private-project-evaluation.js'
import {
  type PrivateProjectEvaluationFailureEvidence,
  privateProjectEvaluationFailureDetails,
} from '../../src/internal/project-evaluation-evidence.js'
import {
  type PrivateProjectEvaluationPhaseEvidence,
  privateProjectEvaluationInvocation,
  privateProjectEvaluationPhaseIdentity,
  privateProjectEvaluationWritableRoots,
  requirePrivateProjectEvaluationOutputFiles,
} from '../../src/internal/project-evaluation-execution.js'
import { normalizePrivateProjectEvaluationRecipe } from '../../src/internal/project-evaluation-policy.js'
import { normalizePrivateProjectEvaluationWorkspace } from '../../src/internal/project-evaluation-workspace.js'
import { parseInvocationContract } from '../../src/invocation-contract.js'
import { canonicalJson } from '../../src/json.js'

describe('project evaluation descriptor and identity validation', () => {
  test('the exact evaluator descriptor compiles as portable Schema/0', () => {
    expect(parseInvocationContract(Buffer.from(JSON.stringify(evaluationContract))).digest).toBe(
      PROJECT_EVALUATION_CONTRACT_DIGEST,
    )
  })

  test('recipe determines fixed invocations and writable roots', () => {
    const recipe = normalizePrivateProjectEvaluationRecipe({
      family: 'bun-typescript',
      generate: 'tools/generate.ts',
      test: ['test/parser.test.ts'],
    })
    expect(privateProjectEvaluationInvocation(recipe, 'generate')).toEqual([
      'bun',
      'tools/generate.ts',
    ])
    expect(privateProjectEvaluationInvocation(recipe, 'compile')).toEqual([
      'bun',
      'node_modules/typescript/lib/tsc.js',
      '--project',
      '.jig-evaluation.json',
    ])
    expect(privateProjectEvaluationInvocation(recipe, 'test')).toEqual([
      'bun',
      'test',
      'test/parser.test.ts',
    ])
    expect(
      privateProjectEvaluationInvocation(
        normalizePrivateProjectEvaluationRecipe({ family: 'bun-typescript', test: recipe.test }),
        'generate',
      ),
    ).toEqual([])
    expect(privateProjectEvaluationWritableRoots('generate')).toEqual(['generated', 'reports'])
    expect(privateProjectEvaluationWritableRoots('compile')).toEqual(['dist'])
    expect(privateProjectEvaluationWritableRoots('test')).toEqual(['reports'])
  })

  test('owner identity includes exact parent and closed position, not new logical calls', () => {
    const input = { parentRunId: 'parent', operationId: 'evaluate', index: 0 as const }
    const identity = privateProjectEvaluationPhaseIdentity(input)
    expect(privateProjectEvaluationPhaseIdentity({ ...input })).toBe(identity)
    expect(privateProjectEvaluationPhaseIdentity({ ...input, index: 1 })).not.toBe(identity)
    expect(
      privateProjectEvaluationPhaseIdentity({ ...input, parentOperationId: 'child' }),
    ).not.toBe(identity)
  })

  test('rejects foreign writable roots and per-file output overflow', () => {
    const file = { path: 'dist/parser.js', bytes: 1, digest: `sha256:${'a'.repeat(64)}` }
    expect(() => requirePrivateProjectEvaluationOutputFiles([file], ['generated'])).toThrow()
    expect(() =>
      requirePrivateProjectEvaluationOutputFiles(
        [{ ...file, bytes: 2 * 1024 * 1024 + 1 }],
        ['dist'],
      ),
    ).toThrow()
    expect(() => requirePrivateProjectEvaluationOutputFiles([file], ['dist'])).not.toThrow()
  })
})

describe('project evaluation failure evidence projection', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const project = (evidence: PrivateProjectEvaluationFailureEvidence) =>
    (
      privateProjectEvaluationFailureDetails(evidence) as unknown as {
        evaluation: PrivateProjectEvaluationFailureEvidence
      }
    ).evaluation
  const base = (): PrivateProjectEvaluationFailureEvidence => ({
    candidateDigest: digest,
    recipeDigest: digest,
    dependencyDigest: digest,
    environmentDigest: null,
    phase: null,
    stage: 'setup',
    limit: 'enclosing',
    phases: [],
    process: null,
    files: null,
    cleanup: 'complete',
  })
  const phaseRecord = () => ({
    phase: 'compile' as const,
    status: 'completed' as const,
    invocation: ['bun', 'node_modules/typescript/lib/tsc.js', '--project', '.jig-evaluation.json'],
    exitCode: 0,
    signal: null,
    stopReason: 'exited' as const,
    durationMs: 250,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
    files: [{ path: 'dist/value.js', bytes: 1, digest }],
  })

  test('preserves setup, missing observations and empty captured manifests distinctly', () => {
    expect(project(base())).toEqual(base())
    const partial = {
      invocation: ['bun', 'test', 'test/value.test.ts'],
      exitCode: null,
      signal: null,
      stopReason: null,
      durationMs: null,
      stdout: null,
      stderr: { text: 'observed stderr', truncated: true },
    }
    const evidence = project({
      ...base(),
      phase: 'test',
      stage: 'collection',
      limit: null,
      process: partial,
      files: [],
    })
    expect(evidence.process).toEqual(partial)
    expect(evidence.files).toEqual([])
    expect(evidence.limit).toBeNull()
  })

  test('retains prior phases and stopped process when output files are unavailable', () => {
    const generation: PrivateProjectEvaluationPhaseEvidence = {
      ...phaseRecord(),
      phase: 'generate',
      status: 'skipped',
      invocation: [],
      exitCode: null,
      stopReason: 'not-configured',
      durationMs: 0,
      files: [],
    }
    const compile = phaseRecord()
    compile.stdout.text = 'compilation completed'
    const stopped = {
      invocation: ['bun', 'test', 'test/value.test.ts'],
      exitCode: null,
      signal: 'SIGKILL',
      stopReason: 'deadline' as const,
      durationMs: 15_000,
      stdout: { text: 'test started', truncated: false },
      stderr: { text: 'cwd:/work\n', truncated: false },
    }
    const evidence = project({
      ...base(),
      environmentDigest: digest,
      phase: 'test',
      stage: 'collection',
      limit: 'phase',
      phases: [generation, compile],
      process: stopped,
      files: null,
    })
    expect(evidence.phases).toEqual([generation, compile])
    expect(evidence.phases.map((phase) => phase.phase)).toEqual(['generate', 'compile'])
    expect(evidence.process).toEqual(stopped)
    expect(evidence.phase).toBe('test')
    expect(evidence.files).toBeNull()
  })

  test('clips failure streams without changing successful source evidence or prior flags', () => {
    const phase = phaseRecord()
    phase.stdout.text = 'a'.repeat(64 * 1024)
    phase.stderr = { text: 'already incomplete', truncated: true }
    const evidence = project({ ...base(), phases: [phase], process: phase })
    expect(evidence.phases[0]?.stdout).toEqual({ text: 'a'.repeat(8192), truncated: true })
    expect(evidence.process?.stdout).toEqual(evidence.phases[0]?.stdout)
    expect(evidence.phases[0]?.stderr).toEqual(phase.stderr)
    expect(evidence.process?.stderr).toEqual(phase.stderr)
    expect(phase.stdout.text.length).toBe(64 * 1024)
    expect(phase.stdout.truncated).toBe(false)
  })

  test('keeps complete UTF-8 scalars at the failure stream boundary', () => {
    for (const [prefix, suffix] of [
      [8190, '😀'],
      [8191, 'é'],
    ] as const) {
      const phase = phaseRecord()
      phase.stdout.text = `${'a'.repeat(prefix)}${suffix}tail`
      const evidence = project({ ...base(), phases: [phase], process: phase })
      expect(evidence.phases[0]?.stdout).toEqual({ text: 'a'.repeat(prefix), truncated: true })
      expect(evidence.process?.stdout).toEqual(evidence.phases[0]?.stdout)
      expect(Buffer.byteLength(evidence.process?.stdout?.text ?? '')).toBe(prefix)
    }
    const phase = phaseRecord()
    phase.stdout.text = '😀'.repeat(2048)
    expect(project({ ...base(), phases: [phase] }).phases[0]?.stdout).toEqual(phase.stdout)
  })

  test('owns immutable copies of phase, process and file metadata', () => {
    const phase = phaseRecord()
    const evidence = project({ ...base(), phases: [phase], process: phase, files: phase.files })
    phase.invocation[0] = 'changed'
    phase.stdout.text = 'changed'
    const file = phase.files[0]
    if (file === undefined) throw new Error('expected source file')
    file.path = 'dist/changed.js'
    phase.files.push({ path: 'dist/new.js', bytes: 0, digest })
    expect(evidence.phases[0]?.invocation[0]).toBe('bun')
    expect(evidence.process?.invocation[0]).toBe('bun')
    expect(evidence.process?.stdout?.text).toBe('')
    expect(evidence.files).toEqual([{ path: 'dist/value.js', bytes: 1, digest }])
    for (const value of [
      evidence,
      evidence.phases,
      evidence.phases[0],
      evidence.phases[0]?.invocation,
      evidence.phases[0]?.stdout,
      evidence.phases[0]?.files,
      evidence.phases[0]?.files[0],
      evidence.process,
      evidence.process?.invocation,
      evidence.process?.stdout,
      evidence.files,
      evidence.files?.[0],
    ]) {
      expect(value !== null && typeof value === 'object').toBe(true)
      expect(Object.isFrozen(value)).toBe(true)
    }
  })

  test('bounds canonical details with maximum streams, control escaping and output metadata', () => {
    const recipe = normalizePrivateProjectEvaluationRecipe({
      family: 'bun-typescript',
      generate: `tools/${'x'.repeat(247)}.ts`,
      test: Array.from(
        { length: 16 },
        (_, number) => `test/${'x'.repeat(241)}${String(number).padStart(2, '0')}.test.ts`,
      ),
    })
    const phases = (
      [
        ['generate', 'generated', 22],
        ['compile', 'dist', 21],
        ['test', 'reports', 21],
      ] as const
    ).map(([phase, root, count]) => {
      return {
        ...phaseRecord(),
        phase,
        invocation: privateProjectEvaluationInvocation(recipe, phase),
        stdout: { text: '\u0000'.repeat(64 * 1024), truncated: false },
        stderr: { text: '\u0000'.repeat(64 * 1024), truncated: false },
        files: Array.from({ length: count }, (_, number) => ({
          path: `${root}/${'x'.repeat(253 - root.length)}${String(number).padStart(2, '0')}`,
          bytes: phase === 'generate' && number < 4 ? 2 * 1024 * 1024 : 0,
          digest,
        })),
      } satisfies PrivateProjectEvaluationPhaseEvidence
    })
    const current = phases[2]
    if (current === undefined) throw new Error('expected current phase')
    const details = privateProjectEvaluationFailureDetails({
      ...base(),
      environmentDigest: digest,
      phase: 'test',
      stage: 'settlement',
      limit: 'phase',
      phases,
      process: current,
      files: current.files,
    })
    const bytes = canonicalJson(details)
    expect(bytes.byteLength).toBeLessThan(512 * 1024)
    expect(bytes.byteLength).toBeGreaterThan(8 * 8192 * 6)
  })
})

describe('closed Linux evaluator workspace projection', () => {
  test('empty directory metadata is canonical content, never arbitrary workspace authority', () => {
    expect(
      normalizePrivateProjectEvaluationWorkspace({
        phase: 'compile',
        emptyDirectories: ['generated/empty', 'src/empty'],
      })?.emptyDirectories,
    ).toEqual(['generated/empty', 'src/empty'])
    for (const emptyDirectories of [['src/../escape'], ['src/z', 'src/a']])
      expect(() =>
        normalizePrivateProjectEvaluationWorkspace({ phase: 'compile', emptyDirectories }),
      ).toThrow()
    expect(
      privateLinuxEvaluationWorkspaceArguments({
        workspace: { phase: 'compile', emptyDirectories: ['src/empty'] },
        source: '/private/verified',
        entries: ['src'],
      }),
    ).toEqual(['--size', String(256 * 1024 * 1024), '--tmpfs', '/work', '--remount-ro', '/run'])
  })

  test('compile keeps generated source immutable and exposes only fresh dist and scratch', () => {
    const args = privateLinuxEvaluationWorkspaceArguments({
      workspace: { phase: 'compile', emptyDirectories: [] },
      source: '/private/verified',
      entries: ['src', 'node_modules', 'generated', 'reports', 'package.json'],
    })
    expect(args).toEqual([
      '--size',
      String(256 * 1024 * 1024),
      '--tmpfs',
      '/work',
      '--remount-ro',
      '/run',
    ])
    expect(args).not.toContain('--symlink')
  })

  test('rejects arbitrary writable roots, traversal and duplicated entries', () => {
    for (const workspace of [{ phase: 'shell' }, { phase: 'test', writable: ['src'] }])
      expect(() =>
        privateLinuxEvaluationWorkspaceArguments({
          workspace,
          source: '/private/verified',
          entries: ['src'],
        }),
      ).toThrow()
    expect(() =>
      privateLinuxEvaluationWorkspaceArguments({
        workspace: { phase: 'test', emptyDirectories: [] },
        source: '/private/verified',
        entries: ['../control'],
      }),
    ).toThrow()
  })
})

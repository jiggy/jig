import { describe, expect, test } from 'bun:test'
import evaluationContract from '../../../../docs/jig/spec/contracts/project-evaluation/contract.json' with {
  type: 'json',
}
import { privateLinuxEvaluationWorkspaceArguments } from '../../src/internal/linux-evaluation-workspace.js'
import { PROJECT_EVALUATION_CONTRACT_DIGEST } from '../../src/internal/private-project-evaluation.js'
import {
  privateProjectEvaluationInvocation,
  privateProjectEvaluationPhaseIdentity,
  privateProjectEvaluationWritableRoots,
  requirePrivateProjectEvaluationOutputFiles,
} from '../../src/internal/project-evaluation-execution.js'
import { normalizePrivateProjectEvaluationRecipe } from '../../src/internal/project-evaluation-policy.js'
import { normalizePrivateProjectEvaluationWorkspace } from '../../src/internal/project-evaluation-workspace.js'
import { parseInvocationContract } from '../../src/invocation-contract.js'

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
    expect(privateProjectEvaluationInvocation(recipe, 'generate')).toEqual(['bun', 'tools/generate.ts'])
    expect(privateProjectEvaluationInvocation(recipe, 'compile')).toEqual([
      'bun', 'node_modules/typescript/lib/tsc.js', '--project', '.jig-evaluation.json',
    ])
    expect(privateProjectEvaluationInvocation(recipe, 'test')).toEqual(['bun', 'test', 'test/parser.test.ts'])
    expect(privateProjectEvaluationInvocation(
      normalizePrivateProjectEvaluationRecipe({ family: 'bun-typescript', test: recipe.test }),
      'generate',
    )).toEqual([])
    expect(privateProjectEvaluationWritableRoots('generate')).toEqual(['generated', 'reports'])
    expect(privateProjectEvaluationWritableRoots('compile')).toEqual(['dist'])
    expect(privateProjectEvaluationWritableRoots('test')).toEqual(['reports'])
  })

  test('owner identity includes exact parent and closed position, not new logical calls', () => {
    const input = { parentRunId: 'parent', operationId: 'evaluate', index: 0 as const }
    const identity = privateProjectEvaluationPhaseIdentity(input)
    expect(privateProjectEvaluationPhaseIdentity({ ...input })).toBe(identity)
    expect(privateProjectEvaluationPhaseIdentity({ ...input, index: 1 })).not.toBe(identity)
    expect(privateProjectEvaluationPhaseIdentity({ ...input, parentOperationId: 'child' })).not.toBe(identity)
  })

  test('rejects foreign writable roots and per-file output overflow', () => {
    const file = { path: 'dist/parser.js', bytes: 1, digest: `sha256:${'a'.repeat(64)}` }
    expect(() => requirePrivateProjectEvaluationOutputFiles([file], ['generated'])).toThrow()
    expect(() =>
      requirePrivateProjectEvaluationOutputFiles(
        [{ ...file, bytes: 2 * 1024 * 1024 + 1 }], ['dist'],
      ),
    ).toThrow()
    expect(() => requirePrivateProjectEvaluationOutputFiles([file], ['dist'])).not.toThrow()
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
      '--size', String(256 * 1024 * 1024), '--tmpfs', '/work', '--remount-ro', '/run',
    ])
    expect(args).not.toContain('--symlink')
  })

  test('rejects arbitrary writable roots, traversal and duplicated entries', () => {
    for (const workspace of [{ phase: 'shell' }, { phase: 'test', writable: ['src'] }])
      expect(() =>
        privateLinuxEvaluationWorkspaceArguments({
          workspace, source: '/private/verified', entries: ['src'],
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

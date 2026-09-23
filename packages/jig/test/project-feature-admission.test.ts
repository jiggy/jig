import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createPrivateActivationCandidateV5 } from '../src/internal/activation-admission.js'
import { privateActivationTargetKey } from '../src/internal/activation-planning.js'
import { privateProjectFeatureFailures } from '../src/internal/project-feature-qualification.js'
import { defineBinding, defineJig, parseRunTargetSelector } from '../src/project/author.js'
import { captureFlowSource } from '../src/project/flow-source.js'
import {
  type InjectedBindingDeclaration,
  linkPackageProject,
  type PackageProjectValue,
} from '../src/project/package-project.js'
import { buildPrivateActivationRequests } from '../src/project/package-resolution.js'
import { retainFlowSourcePackages } from '../src/project/retained-flow.js'
import { settleTestCommand } from './fixtures/bounded-command.js'

// These cases retain and clean multiple packages on disk. Let storage settle
// under the combined release suite without changing production deadlines.
setDefaultTimeout(20_000)

const contractId = 'https://example.org/contracts/feature-review'
const contract = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
  id: contractId,
  version: '1.0.0',
  features: { conversation: 'Implements serial follow-up requests; authority is separate.' },
  input: { type: 'string' },
  result: { type: 'string' },
})

describe('retained project feature admission evidence', () => {
  test('propagates a mismatch through an untyped caller without refusing unrelated targets', async () => {
    await withProject(
      {
        'flows/provider': provider([]),
        'flows/consumer': consumer(['conversation']),
        'flows/baseline': consumer(),
        'flows/wrapper': run('wrapper'),
        'flows/unrelated': run('unrelated'),
      },
      [
        binding('consumer', { package: 'flows/consumer' }),
        binding('wrapper', {
          package: 'flows/wrapper',
          slots: { child: 'binding:consumer' },
        }),
      ],
      (project) => {
        const failures = privateProjectFeatureFailures(project)
        expect([...failures.keys()].sort()).toEqual(
          ['binding:consumer', 'binding:wrapper', 'flow:flows/consumer'].map(key),
        )
        expect(failures.get(key('binding:wrapper'))).not.toBe(failures.get(key('binding:consumer')))
        const requests = buildPrivateActivationRequests(project)
        expect(requests.map(({ target }) => privateActivationTargetKey(target))).toContain(
          key('flow:flows/provider'),
        )
        expect(failures.has(key('flow:flows/baseline'))).toBeFalse()
        expect(failures.has(key('flow:flows/unrelated'))).toBeFalse()
      },
      { [contractId]: 'flow:flows/provider' },
    )
  })

  test('qualifies exact binding overrides without silently replacing the failing default', async () => {
    await withProject(
      {
        'flows/provider': provider([]),
        'flows/supported': provider(['conversation']),
        'flows/consumer': consumer(['conversation']),
        'flows/wrapper': run('wrapper'),
      },
      [
        binding('qualified', {
          package: 'flows/consumer',
          slots: { review: 'flow:flows/supported' },
        }),
        binding('wrapper', {
          package: 'flows/wrapper',
          slots: { child: 'binding:qualified' },
        }),
      ],
      (project) => {
        expect([...privateProjectFeatureFailures(project).keys()]).toEqual([
          key('flow:flows/consumer'),
        ])
        const request = buildPrivateActivationRequests(project).find(
          ({ target }) => privateActivationTargetKey(target) === key('flow:flows/consumer'),
        )
        assert(request)
        expect(request.slots.review).toMatchObject({
          kind: 'flow',
          target: { kind: 'flow', path: 'flows/provider' },
        })
      },
      { [contractId]: 'flow:flows/provider' },
    )
  })

  test('does not infer implementation support from the catalog or accepted settings', async () => {
    for (const supports of [undefined, []]) {
      await withProject(
        {
          'flows/provider': provider(supports),
          'flows/consumer': consumer(['conversation']),
          'flows/empty': consumer([]),
        },
        [],
        (project) => {
          expect([...privateProjectFeatureFailures(project).keys()]).toEqual([
            key('flow:flows/consumer'),
          ])
        },
        { [contractId]: 'flow:flows/provider' },
      )
    }
    await withProject(
      {
        'flows/provider': {
          ...provider(['conversation']),
          'settings.schema.json': JSON.stringify({
            $schema: 'https://flow.jig.md/schemas/schema-0.json',
            type: 'object',
            properties: { mode: { enum: ['quiet', 'verbose'] } },
            additionalProperties: false,
          }),
        },
      },
      [binding('quiet', { package: 'flows/provider', settings: { mode: 'quiet' } })],
      (project) => {
        // Qualification inspects unconditional claims, not settings-dependent capability proofs.
        expect(privateProjectFeatureFailures(project).size).toBe(0)
        expect(project.flows[0]?.metadata.supports).toEqual(['conversation'])
      },
    )
  })

  test('pins the selected provider bytes in direct refusal evidence', async () => {
    const evidence: string[] = []
    for (const description of ['First captured implementation.', 'Revised implementation.']) {
      await withProject(
        {
          'flows/provider': {
            ...provider([]),
            'FLOW.meta.json': JSON.stringify({ name: 'provider', description, supports: [] }),
          },
          'flows/consumer': consumer(['conversation']),
        },
        [],
        (project) => {
          const failure = privateProjectFeatureFailures(project).get(key('flow:flows/consumer'))
          expect(failure).toMatch(/^sha256:[0-9a-f]{64}$/)
          assert(failure)
          evidence.push(failure)
        },
        { [contractId]: 'flow:flows/provider' },
      )
    }
    expect(evidence).toHaveLength(2)
    expect(evidence[0]).not.toBe(evidence[1])
  })

  test('uses captured claim bytes and rejects copied values as admission authority', async () => {
    await withProject(
      {
        'flows/provider': provider([]),
        'flows/consumer': consumer(['conversation']),
      },
      [],
      async (project, root) => {
        const before = [...privateProjectFeatureFailures(project)]
        await writeFile(
          join(root, 'flows/provider/FLOW.meta.json'),
          JSON.stringify({ name: 'provider', supports: ['conversation'] }),
        )
        expect([...privateProjectFeatureFailures(project)]).toEqual(before)
        assert(project.flows[0])
        expect(Object.isFrozen(project.flows[0].metadata)).toBeTrue()
        expect(() => privateProjectFeatureFailures(structuredClone(project))).toThrow(
          'project was not produced by the package-project linker',
        )
        expect(() =>
          createPrivateActivationCandidateV5({ linked: project } as never, {
            targets: [{ disposition: { state: 'planned' } }],
          }),
        ).toThrow('project was not produced by the retained aggregate boundary')
      },
      { [contractId]: 'flow:flows/provider' },
    )
  })

  test('admission independently refuses planned mismatches and false refusal evidence', async () => {
    await withProject(
      {
        'flows/provider': provider([]),
        'flows/consumer': consumer(['conversation']),
      },
      [],
      async (_project, root) => {
        await writeFile(join(root, 'jig.ts'), 'export default {};\n')
        // Isolate the inert evaluator fixture from every other test's module cache.
        // Capture, linking, planning observations, feature checks and admission stay real.
        const child = Bun.spawn([process.execPath, '--eval', admissionScript(root)], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const result = await settleTestCommand(child, {
          evidence: join(root, 'admission-check'),
          timeoutMs: 15_000,
        })
        expect(result.code, result.stderr).toBe(0)
        expect(result.stdout).toContain('retained feature admission invariants passed')
      },
      { [contractId]: 'flow:flows/provider' },
    )
  }, 20_000)
})

function admissionScript(root: string): string {
  const module = (path: string) => JSON.stringify(new URL(path, import.meta.url).href)
  return `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    const d = (character) => 'sha256:' + character.repeat(64);
    const { defineJig } = await import(${module('../src/project/author.js')});
    const definition = defineJig({
      flows: ['flows/consumer', 'flows/provider'],
      defaultProviders: { ${JSON.stringify(contractId)}: 'flow:flows/provider' },
    });
    mock.module(${module('../src/project/author-evaluator.js')}, () => ({
      evaluateAuthorClosure: async (_options, _captured, entryProjectPath, expected) => ({
        expected,
        source: { entryProjectPath },
        profile: { fixture: 'inert-feature-admission-unit' },
        outputDigest: d('a'),
        value: definition,
      }),
    }));
    const { retainPackageProject } = await import(${module('../src/project/retained-project.js')});
    const { buildPrivateActivationRequests, resolveRetainedPackageProjectObservation } =
      await import(${module('../src/project/package-resolution.js')});
    const { createPrivateActivationCandidateV5 } =
      await import(${module('../src/internal/activation-admission.js')});
    const { privateProjectFeatureFailures } =
      await import(${module('../src/internal/project-feature-qualification.js')});
    const { createPrivateActivationPlanningObservation, createPrivateActivationRecipeObservation,
      privateActivationTargetKey } = await import(${module('../src/internal/activation-planning.js')});
    const retained = await retainPackageProject({
      projectRoot: ${JSON.stringify(root)},
      storeRoot: ${JSON.stringify(join(root, 'store'))},
      evaluator: undefined,
    });
    const requests = buildPrivateActivationRequests(retained.linked);
    const failures = privateProjectFeatureFailures(retained.linked);
    const refused = requests.find((request) => failures.has(privateActivationTargetKey(request.target)));
    assert(refused);
    const evidence = failures.get(privateActivationTargetKey(refused.target));
    const unavailable = (code, evidenceDigests = [d('b')]) => ({ state: 'unavailable', code, evidenceDigests });
    function candidate(refusal, other = unavailable('RUNTIME_UNAVAILABLE')) {
      const planning = createPrivateActivationPlanningObservation({
        policyDigest: d('c'), mechanismDigest: d('d'),
        entries: requests.map((request) => ({
          target: request.target, requestDigest: request.digest,
          disposition: request.digest === refused.digest ? refusal : other,
        })),
      });
      return createPrivateActivationCandidateV5(
        retained, resolveRetainedPackageProjectObservation(retained, planning),
      );
    }
    const correct = unavailable('FEATURE_UNAVAILABLE', [evidence]);
    const accepted = candidate(correct);
    assert.equal(accepted.candidate.targets.find((target) => target.request.digest === refused.digest)
      .disposition.code, 'FEATURE_UNAVAILABLE');
    assert.throws(() => candidate(unavailable('RUNTIME_UNAVAILABLE')),
      /target requires unsupported implementation features/);
    assert.throws(() => candidate(unavailable('FEATURE_UNAVAILABLE')),
      /target requires unsupported implementation features/);
    assert.throws(() => candidate(unavailable('FEATURE_UNAVAILABLE', [evidence, d('b')])),
      /target requires unsupported implementation features/);
    assert.throws(() => candidate(correct, unavailable('FEATURE_UNAVAILABLE', [evidence])),
      /feature refusal has no retained declaration evidence/);
    const extension = { artifactDigest: d('e'), revision: 'unit/1' };
    const observation = createPrivateActivationRecipeObservation({
      requestDigest: refused.digest, adapter: extension, toolchainDigest: d('e'),
      inspectionDigest: d('e'), launchPlanner: extension, backend: extension,
      launchEnvelopeDigest: d('e'), installedSupportDigest: d('e'), runtimePredicates: [],
      requestedAuthorityDigest: d('e'), wouldGrantAuthorityDigest: d('e'), plannedAuthorityDigest: d('e'),
    });
    // No recipe-authentication mock: declaration rejection must precede ready recipe checks.
    assert.throws(() => candidate({ state: 'planned', observation }),
      /target requires unsupported implementation features/);
    process.stdout.write('retained feature admission invariants passed\\n');
  `
}

function key(selector: string): string {
  return privateActivationTargetKey(parseRunTargetSelector(selector, 'test target'))
}

function run(name: string): Record<string, string> {
  return {
    'FLOW.meta.json': JSON.stringify({ name }),
    'FLOW.ts': 'throw new Error("Feature review must never execute this package.");\n',
  }
}

function provider(supports?: readonly string[]): Record<string, string> {
  return {
    ...run('provider'),
    'FLOW.meta.json': JSON.stringify({ name: 'provider', ...(supports ? { supports } : {}) }),
    'FLOW.contract.json': contract,
  }
}

function consumer(requires?: readonly string[]): Record<string, string> {
  return {
    ...run('consumer'),
    'FLOW.meta.json': JSON.stringify({
      name: 'consumer',
      uses: {
        review: {
          contract: './contracts/review.json',
          ...(requires === undefined ? {} : { requires }),
        },
      },
    }),
    'contracts/review.json': contract,
  }
}

function binding(
  id: string,
  definition: Parameters<typeof defineBinding>[0],
): InjectedBindingDeclaration {
  return { sourcePath: `bindings/${id}.ts`, definition: defineBinding(definition) }
}

async function withProject(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  bindings: readonly InjectedBindingDeclaration[],
  action: (project: PackageProjectValue, root: string) => Promise<void> | void,
  defaultProviders: Readonly<Record<string, string>> = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-feature-admission-'))
  const store = join(root, 'store')
  let source: Awaited<ReturnType<typeof captureFlowSource>> | undefined
  try {
    await mkdir(store, { mode: 0o700 })
    for (const [path, tree] of Object.entries(trees)) {
      for (const [name, contents] of Object.entries(tree)) {
        const file = join(root, path, name)
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, contents)
      }
    }
    source = await captureFlowSource(root, defineJig({ flows: Object.keys(trees) }).flows)
    const flows = await retainFlowSourcePackages(store, source)
    await action(linkPackageProject({ flows, bindings, defaultProviders }), root)
  } finally {
    await source?.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

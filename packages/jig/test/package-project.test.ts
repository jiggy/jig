import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import {
  captureStoredPackage,
  type PackageArtifactRef,
} from '../src/internal/package-artifact-store.js'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from '../src/internal/private-agent-run.js'
import { defineJig } from '../src/project/author.js'
import { captureFlowSource } from '../src/project/flow-source.js'
import {
  type InjectedBindingDeclaration,
  linkPackageProject,
} from '../src/project/package-project.js'
import { type RetainedFlowInput, retainFlowSourcePackages } from '../src/project/retained-flow.js'

const schemaUri = 'https://flow.jig.md/schemas/schema-1.json'
const acpPublicUpdates = await readFile(
  new URL(
    '../../../docs/jig/spec/contracts/agent-run/contracts/acp-public-updates.json',
    import.meta.url,
  ),
  'utf8',
)
const agentRunContract = await readFile(
  new URL('../../../docs/jig/spec/contracts/agent-run/contract.json', import.meta.url),
  'utf8',
)

describe('private package-project linker', () => {
  test('retains captured Flow members without taking source ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-retained-source-'))
    const store = join(root, 'store')
    const packageRoot = join(root, 'flows', 'run')
    await mkdir(store, { mode: 0o700 })
    await mkdir(packageRoot, { recursive: true })
    await writeFile(
      join(packageRoot, 'flow.meta.json'),
      metadata({ name: 'run', description: 'Run.' }),
    )
    await writeFile(join(packageRoot, 'FLOW.ts'), 'export {};\n')
    const source = await captureFlowSource(root, defineJig({ flows: ['flows/run'] }).flows)
    try {
      const retained = await retainFlowSourcePackages(store, source)
      expect(retained).toHaveLength(1)
      await source.dispose()
      const reopened = await captureStoredPackage(store, retained[0]!.package)
      try {
        expect(new TextDecoder().decode(await reopened.read('FLOW.ts'))).toBe('export {};\n')
      } finally {
        await reopened.dispose()
      }
    } finally {
      await source.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('links and canonically orders minimal direct Run packages', async () => {
    await withFlows(
      {
        'flows/z': run('z'),
        'flows/a': run('a'),
      },
      async ([z, a]) => {
        const value = linkPackageProject({ flows: [z!, a!], bindings: [] })
        expect(value.flows.map((flow) => flow.provenance.projectPath)).toEqual([
          'flows/a',
          'flows/z',
        ])
        expect(value.flows.every((flow) => flow.directRun)).toBeTrue()
        expect(value.bindings).toEqual([])
        expect(Object.isFrozen(value)).toBeTrue()
        expect(Object.isFrozen(value.flows)).toBeTrue()
        expectCode(
          () => linkPackageProject({ flows: [z!, a!], bindings: [] }, 1),
          'PROJECT_ACTIVATION_TARGET_LIMIT',
        )
      },
    )
  })

  test('rejects forged retained inputs and oversized or active containers', () => {
    const forged = Object.freeze({
      provenance: Object.freeze({ membership: 'exact', projectPath: 'flows/forged' }),
      package: Object.freeze({ kind: 'flow-package/1', digest: `sha256:${'a'.repeat(64)}` }),
      inspected: Object.freeze({ digest: `sha256:${'a'.repeat(64)}` }),
    })
    expectCode(
      () => linkPackageProject({ flows: [forged] as never, bindings: [] }),
      'PROJECT_FLOW_NOT_RETAINED',
    )
    expectCode(
      () =>
        linkPackageProject({
          flows: new Array(65_537).fill(null) as never,
          bindings: [],
        }),
      'PROJECT_PACKAGE_LIMIT',
    )

    let invoked = false
    const flows = Object.defineProperty([], Symbol.iterator, {
      value: () => {
        invoked = true
        return [][Symbol.iterator]()
      },
    })
    expectCode(() => linkPackageProject({ flows, bindings: [] }), 'PROJECT_PACKAGE_INPUT')
    expect(invoked).toBeFalse()
  })

  test('bounds aggregate semantic work across individually valid Bindings', async () => {
    // This million-node input tests the semantic-work ceiling, not a five-second
    // throughput promise; allow bounded headroom under the complete suite.
    await withFlows(
      {
        'flows/configurable': {
          'flow.meta.json': metadata({ name: 'configurable', description: 'Configurable.' }),
          'FLOW.ts': 'export {};\n',
          'settings.schema.json': schema({ type: 'object' }),
        },
      },
      async (flows) => {
        const settings = { values: new Array(60_000).fill(null) }
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: Array.from({ length: 17 }, (_, index) =>
                binding(`bindings/b-${index}.ts`, { package: 'flows/configurable', settings }),
              ),
            }),
          'PROJECT_PACKAGE_WORK_LIMIT',
        )
      },
    )
  }, 20_000)

  test('links a basic Binding with validated settings', async () => {
    await withFlows(
      {
        'flows/review': {
          'flow.meta.json': metadata({ name: 'review', description: 'Review.' }),
          'FLOW.ts': 'export {};\n',
          'settings.schema.json': schema({
            type: 'object',
            properties: { maxRetries: { type: 'integer', minimum: 1 } },
            required: ['maxRetries'],
            additionalProperties: false,
          }),
        },
      },
      async (flows) => {
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/review.ts', {
                  package: 'flows/review',
                  settings: { maxRetries: 0 },
                }),
              ],
            }),
          'PROJECT_BINDING_SETTINGS_INVALID',
          '/settings/maxRetries',
        )
        const value = linkPackageProject({
          flows,
          bindings: [
            binding('bindings/review.ts', {
              package: 'flows/review',
              settings: { maxRetries: 3 },
            }),
          ],
        })
        expect(value.bindings).toEqual([
          {
            kind: 'package',
            id: 'review',
            declarationPath: 'bindings/review.ts',
            packagePath: 'flows/review',
            settings: { maxRetries: 3 },
            slots: {},
          },
        ])
        expect(value.flows[0]!.directRun).toBeFalse()
      },
    )
  })

  test('links exact direct child Flow slots and rejects invalid relations', async () => {
    await withFlows(
      {
        'flows/router': run('router'),
        'flows/bug': run('bug'),
        'flows/configured': {
          'flow.meta.json': metadata({ name: 'configured', description: 'Configured.' }),
          'FLOW.ts': 'export {};\n',
          'settings.schema.json': schema({
            type: 'object',
            required: ['value'],
          }),
        },
      },
      async (flows) => {
        const value = linkPackageProject({
          flows,
          bindings: [
            binding('bindings/router.ts', {
              package: 'flows/router',
              slots: { bug: 'flow:flows/bug' },
            }),
          ],
        })
        expect(value.bindings[0]!.slots).toEqual({ bug: { kind: 'flow', path: 'flows/bug' } })

        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/router.ts', {
                  package: 'flows/router',
                  slots: { bug: 'flow:flows/missing' },
                }),
              ],
            }),
          'PROJECT_BINDING_SLOT_MISSING',
          '/slots/bug',
        )
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/router.ts', {
                  package: 'flows/router',
                  slots: { loop: 'flow:flows/router' },
                }),
              ],
            }),
          'PROJECT_BINDING_SLOT_RECURSIVE',
          '/slots/loop',
        )
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/router.ts', {
                  package: 'flows/router',
                  slots: { configured: 'flow:flows/configured' },
                }),
              ],
            }),
          'PROJECT_BINDING_SLOT_NOT_DIRECT',
          '/slots/configured',
        )
      },
    )
  })

  test('requires an explicit matching target for an ordinary named interface', async () => {
    await withFlows(
      {
        'flows/consumer': {
          'flow.meta.json': metadata({
            name: 'consumer',
            description: 'Consumer.',
            uses: { index: { contract: './contracts/index.json' } },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/index.json': invocation({
            id: 'https://example.org/contracts/index',
            version: '1.0.0',
          }),
        },
      },
      async (flows) => {
        const linked = linkPackageProject({ flows, bindings: [] })
        expect(linked.flows[0]!.directRun).toBeFalse()
        expect(linked.flows[0]!.uses.index).toMatchObject({
          id: 'https://example.org/contracts/index',
          version: '1.0.0',
        })
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [binding('bindings/consumer.ts', { package: 'flows/consumer' })],
            }),
          'PROJECT_BINDING_INTERFACE_UNRESOLVED',
          '/slots',
        )
      },
    )
  })

  test('accepts exact ordinary Flow and Binding substitutes and rejects missing or changed offers', async () => {
    const contract = invocation({
      id: 'https://example.org/contracts/review',
      version: '1.0.0',
      input: { type: 'string' },
      result: {
        type: 'object',
        properties: { outcome: { const: 'done' }, output: { type: 'string' } },
        required: ['outcome', 'output'],
        additionalProperties: false,
      },
    })
    await withFlows(
      {
        'flows/consumer': {
          ...run('consumer'),
          'flow.meta.json': metadata({
            name: 'consumer',
            uses: { review: { contract: './contracts/review.json' } },
          }),
          'contracts/review.json': contract,
        },
        'flows/first': { ...run('first'), 'contract.json': contract },
        'flows/second': { ...run('second'), 'contract.json': contract },
        'flows/plain': run('plain'),
        'flows/changed': {
          ...run('changed'),
          'contract.json': invocation({
            ...JSON.parse(contract),
            result: {
              type: 'object',
              properties: { outcome: { const: 'done' }, output: { type: 'integer' } },
              required: ['outcome', 'output'],
              additionalProperties: false,
            },
          }),
        },
      },
      (flows) => {
        for (const target of ['flow:flows/first', 'flow:flows/second', 'binding:configured']) {
          const linked = linkPackageProject({
            flows,
            bindings: [
              binding('bindings/configured.ts', { package: 'flows/second' }),
              binding('bindings/consumer.ts', {
                package: 'flows/consumer',
                slots: { review: target },
              }),
            ],
          })
          expect(linked.bindings.find(({ id }) => id === 'consumer')!.slots.review).toEqual(
            target === 'binding:configured'
              ? { kind: 'binding', id: 'configured' }
              : { kind: 'flow', path: target.slice(5) },
          )
          expect(
            linked.flows.find(({ provenance }) => provenance.projectPath === 'flows/consumer')!
              .directRun,
          ).toBeFalse()
        }
        for (const target of ['flow:flows/plain', 'flow:flows/changed']) {
          expectCode(
            () =>
              linkPackageProject({
                flows,
                bindings: [
                  binding('bindings/consumer.ts', {
                    package: 'flows/consumer',
                    slots: { review: target },
                  }),
                ],
              }),
            'PROJECT_BINDING_INTERFACE_MISMATCH',
            '/slots/review',
          )
        }
      },
    )
  })

  test('refuses ordinary Flow and Binding substitution for an exact native interface', async () => {
    await withFlows(
      {
        'flows/consumer': {
          ...run('consumer'),
          'flow.meta.json': metadata({
            name: 'consumer',
            uses: { agent: { contract: './contracts/agent-run/contract.json' } },
          }),
          'contracts/agent-run/contract.json': agentRunContract,
          'contracts/agent-run/contracts/acp-public-updates.json': acpPublicUpdates,
        },
        'flows/impostor': {
          ...run('impostor'),
          'contract.json': agentRunContract,
          'contracts/acp-public-updates.json': acpPublicUpdates,
        },
      },
      (flows) => {
        expect(
          linkPackageProject({ flows, bindings: [] }).flows.find(
            ({ provenance }) => provenance.projectPath === 'flows/consumer',
          )!.directRun,
        ).toBeTrue()
        for (const target of ['flow:flows/impostor', 'binding:impostor']) {
          expectCode(
            () =>
              linkPackageProject({
                flows,
                bindings: [
                  binding('bindings/impostor.ts', { package: 'flows/impostor' }),
                  binding('bindings/consumer.ts', {
                    package: 'flows/consumer',
                    slots: { agent: target },
                  }),
                ],
              }),
            'PROJECT_BINDING_INTERFACE_MISMATCH',
            '/slots/agent',
          )
        }
      },
    )
  })

  test('admits one native Agent slot and freezes its exact identity', async () => {
    await withFlows(
      {
        'flows/agent-consumer': {
          'flow.meta.json': metadata({
            name: 'agent-consumer',
            description: 'Agent consumer.',
            uses: { agent: { contract: './contracts/agent-run/contract.json' } },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/agent-run/contract.json': agentRunContract,
          'contracts/agent-run/contracts/acp-public-updates.json': acpPublicUpdates,
        },
      },
      async ([flow]) => {
        const linked = linkPackageProject({ flows: [flow!], bindings: [] })
        expect(linked.flows[0]!.directRun).toBeTrue()
        expect(linked.flows[0]!.uses).toEqual({
          agent: {
            id: AGENT_RUN_CONTRACT_ID,
            version: AGENT_RUN_CONTRACT_VERSION,
            digest: AGENT_RUN_CONTRACT_DIGEST,
          },
        })
        expect(Object.isFrozen(linked.flows[0]!.uses)).toBeTrue()
        expect(Object.isFrozen(linked.flows[0]!.uses.agent)).toBeTrue()
      },
    )
  })

  test('requires explicit uncontracted slots and rejects repeated native selections', async () => {
    await withFlows(
      {
        'flows/local': {
          'flow.meta.json': metadata({
            name: 'local',
            description: 'Local.',
            uses: { child: {} },
          }),
          'FLOW.ts': 'export {};\n',
        },
        'flows/multiple': {
          'flow.meta.json': metadata({
            name: 'multiple',
            description: 'Multiple.',
            uses: {
              primary: { contract: './contracts/agent-run/contract.json' },
              secondary: { contract: './contracts/agent-run/contract.json' },
            },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/agent-run/contract.json': agentRunContract,
          'contracts/agent-run/contracts/acp-public-updates.json': acpPublicUpdates,
        },
      },
      async ([local, multiple]) => {
        expect(
          linkPackageProject({ flows: [local!], bindings: [] }).flows[0]!.directRun,
        ).toBeFalse()
        expect(
          linkPackageProject({ flows: [multiple!], bindings: [] }).flows[0]!.directRun,
        ).toBeFalse()
        expectCode(
          () =>
            linkPackageProject({
              flows: [local!],
              bindings: [binding('bindings/local.ts', { package: 'flows/local' })],
            }),
          'PROJECT_BINDING_INTERFACE_UNRESOLVED',
          '/slots',
        )
        expectCode(
          () =>
            linkPackageProject({
              flows: [multiple!],
              bindings: [binding('bindings/multiple.ts', { package: 'flows/multiple' })],
            }),
          'PROJECT_BINDING_INTERFACE_UNRESOLVED',
          '/slots',
        )
      },
    )
  })

  test('links Agent-bearing direct children and configured Binding children', async () => {
    await withFlows(
      {
        'flows/router': run('router'),
        'flows/agent-child': {
          'flow.meta.json': metadata({
            name: 'agent-child',
            description: 'Agent child.',
            uses: { agent: { contract: './contracts/agent-run/contract.json' } },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/agent-run/contract.json': agentRunContract,
          'contracts/agent-run/contracts/acp-public-updates.json': acpPublicUpdates,
          'settings.schema.json': schema({
            type: 'object',
            properties: { style: { type: 'string' } },
          }),
        },
      },
      async (flows) => {
        const linked = linkPackageProject({
          flows,
          bindings: [
            binding('bindings/router.ts', {
              package: 'flows/router',
              slots: { agent: 'flow:flows/agent-child', configured: 'binding:reviewer' },
            }),
            binding('bindings/reviewer.ts', {
              package: 'flows/agent-child',
              settings: { style: 'critical' },
            }),
          ],
        })
        const router = linked.bindings.find(({ id }) => id === 'router')!
        expect(router.slots).toEqual({
          agent: { kind: 'flow', path: 'flows/agent-child' },
          configured: { kind: 'binding', id: 'reviewer' },
        })
        expect(Object.isFrozen(router.slots.configured)).toBeTrue()
        expect(linked.bindings.find(({ id }) => id === 'reviewer')!.settings).toEqual({
          style: 'critical',
        })
      },
    )
  })

  test('rejects unknown, self, cyclic, and nonleaf Binding slot targets', async () => {
    await withFlows(
      {
        'flows/router': run('router'),
        'flows/reviewer': run('reviewer'),
        'flows/leaf': run('leaf'),
      },
      async (flows) => {
        const router = (target: string) =>
          binding('bindings/router.ts', {
            package: 'flows/router',
            slots: { child: target },
          })
        expectCode(
          () => linkPackageProject({ flows, bindings: [router('binding:missing')] }),
          'PROJECT_BINDING_SLOT_MISSING',
          '/slots/child',
        )
        expectCode(
          () => linkPackageProject({ flows, bindings: [router('binding:router')] }),
          'PROJECT_BINDING_SLOT_RECURSIVE',
          '/slots/child',
        )
        for (const target of ['flow:flows/leaf', 'binding:router']) {
          expectCode(
            () =>
              linkPackageProject({
                flows,
                bindings: [
                  router('binding:reviewer'),
                  binding('bindings/reviewer.ts', {
                    package: 'flows/reviewer',
                    slots: { child: target },
                  }),
                ],
              }),
            'PROJECT_BINDING_SLOT_NOT_LEAF',
            '/slots/child',
          )
        }
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                router('binding:alias'),
                binding('bindings/alias.ts', { package: 'flows/router' }),
              ],
            }),
          'PROJECT_BINDING_SLOT_RECURSIVE',
          '/slots/child',
        )
      },
    )
  })

  test('rejects mismatched retained facts and declaration identities', async () => {
    await withFlows({ 'flows/run': run('run') }, async ([flow]) => {
      const wrongReference = {
        ...flow!.package,
        digest: `sha256:${'0'.repeat(64)}`,
      } as PackageArtifactRef
      expectCode(
        () =>
          linkPackageProject({
            flows: [{ ...flow!, package: wrongReference }],
            bindings: [],
          }),
        'PROJECT_FLOW_NOT_RETAINED',
      )
      expectCode(
        () =>
          linkPackageProject({
            flows: [flow!],
            bindings: [binding('bindings/Bad.ts', { package: 'flows/run' })],
          }),
        'PROJECT_BINDING_ID',
      )
      expectCode(
        () =>
          linkPackageProject({
            flows: [flow!],
            bindings: [binding('bindings/one.ts', { package: 'flows/missing' })],
          }),
        'PROJECT_BINDING_PACKAGE_MISSING',
      )
    })
  })

  test('supports attachment-bearing roots but rejects them as Flow or Binding children', async () => {
    await withFlows(
      {
        'flows/plain': run('plain'),
        'flows/configured': {
          'flow.meta.json': metadata({ name: 'configured', description: 'Configured.' }),
          'contract.json': invocation({ attachments: { source: 'read' } }),
          'FLOW.ts': 'export {};\n',
        },
      },
      async (flows) => {
        expectCode(
          () =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/plain.ts', {
                  package: 'flows/plain',
                  settings: { unexpected: true },
                }),
              ],
            }),
          'PROJECT_BINDING_SETTINGS_UNDECLARED',
          '/settings',
        )
        expect(
          linkPackageProject({
            flows,
            bindings: [binding('bindings/configured.ts', { package: 'flows/configured' })],
          }).bindings,
        ).toHaveLength(1)
        for (const selector of ['flow:flows/configured', 'binding:configured']) {
          expectCode(
            () =>
              linkPackageProject({
                flows,
                bindings: [
                  binding('bindings/configured.ts', { package: 'flows/configured' }),
                  binding('bindings/plain.ts', {
                    package: 'flows/plain',
                    slots: { child: selector },
                  }),
                ],
              }),
            'PROJECT_BINDING_SLOT_ATTACHMENTS_UNSUPPORTED',
            '/slots/child',
          )
        }
      },
    )
  })

  test('rejects more than one writable root attachment during review', async () => {
    await withFlows(
      {
        'flows/files': {
          'flow.meta.json': metadata({ name: 'files', description: 'Files.' }),
          'contract.json': invocation({
            attachments: { first: 'read-write', second: 'read-write' },
          }),
          'FLOW.ts': 'export {};\n',
        },
      },
      (flows) => {
        expectCode(
          () => linkPackageProject({ flows, bindings: [] }),
          'PROJECT_ATTACHMENTS_UNSUPPORTED',
        )
      },
    )
  })

  test('retains deeply immutable semantic facts and linked values', async () => {
    await withFlows(
      {
        'flows/immutable': {
          'flow.meta.json': metadata({
            name: 'immutable',
            description: 'Immutable.',
            'x-state': { nested: ['safe'] },
          }),
          'FLOW.ts': 'export {};\n',
        },
      },
      async (flows) => {
        const value = linkPackageProject({
          flows,
          bindings: [binding('bindings/immutable.ts', { package: 'flows/immutable' })],
        })
        const metadata = value.flows[0]!.metadata
        expect(Object.isFrozen(metadata)).toBeTrue()
        expect(Object.isFrozen(value.flows[0]!.entrypoint)).toBeTrue()
        expect(Object.isFrozen(metadata.extensions['x-state'])).toBeTrue()
        expect(
          Object.isFrozen((metadata.extensions['x-state'] as { nested: readonly string[] }).nested),
        ).toBeTrue()
        expect(() => {
          ;(metadata as { name: string }).name = 'changed'
        }).toThrow()
        expect(() => {
          ;(value.bindings[0]!.settings as Record<string, unknown>).extra = true
        }).toThrow()
        expect(metadata.name).toBe('immutable')
      },
    )
  })
})

function run(name: string): Record<string, string> {
  return {
    'flow.meta.json': metadata({ name, description: `${name}.` }),
    'FLOW.ts': 'export {};\n',
  }
}

function binding(sourcePath: string, definition: unknown): InjectedBindingDeclaration {
  return { sourcePath, definition }
}

function metadata(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

function schema(value: Record<string, unknown>): string {
  return JSON.stringify({ $schema: schemaUri, ...value })
}

function invocation(value: Record<string, unknown> = {}): string {
  return JSON.stringify({
    $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
    ...value,
  })
}

async function withFlows(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: (flows: readonly RetainedFlowInput[]) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-package-project-'))
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
    await action(await retainFlowSourcePackages(store, source))
  } finally {
    await source?.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

function expectCode(action: () => unknown, code: string, pointer?: string): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toMatchObject({ code, ...(pointer === undefined ? {} : { pointer }) })
}

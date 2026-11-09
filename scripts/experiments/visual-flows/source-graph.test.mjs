import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { extractSourceGraph, parseAuthoredModule, UnsupportedSourceError } from './source-graph.mjs'

const project = (body) =>
  `import { defineJig, discover } from '@jigging/jig'\nexport default defineJig(${body})\n`
const binding = (body) =>
  `import { defineBinding } from '@jigging/jig'\nexport default defineBinding(${body})\n`
const metadata = (uses) => JSON.stringify({ name: 'Example method', uses })

async function fixture(files, action) {
  const base = fileURLToPath(new URL('./.tmp/', import.meta.url))
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'source-test-'))
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(directory, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, contents)
    }
    return await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('literal parser preserves values, trailing commas, comments and source locations', () => {
  const parsed = parseAuthoredModule(
    `
import { defineBinding, } from '@jigging/jig';
/* Names are data. */
export default defineBinding({
  package: 'flows/example',
  settings: { text: 'it\\'s \\u0041 \\x42', enabled: true, missing: null, number: -1.25e2, },
  slots: { worker: 'binding:worker', },
});
`,
    { file: 'bindings/example.ts', helper: 'defineBinding' },
  )
  assert.equal(parsed.value.settings.text, "it's A B")
  assert.equal(parsed.value.settings.number, -125)
  assert.equal(parsed.locations.get('/slots/worker').line, 7)
  assert.equal(parsed.locations.get('/slots/worker').path, 'bindings/example.ts')
})

test('unsupported expressions and extra module statements fail without execution', () => {
  const key = '__sourceGraphExecuted'
  const before = globalThis[key]
  const sources = [
    project('{ flows: getFlows() }'),
    project("{ flows: ['flows/a'], ...extra }"),
    project('{ flows }'),
    project("{ ['flows']: [] }"),
    project('{ get flows() { return [] } }'),
    project('{ flows: [`flows/${name}`] }'),
    project('{ flows: [] } as const'),
    project('{ flows: [] }') + `globalThis.${key} = true`,
    `globalThis.${key} = true\n` + project('{ flows: [] }'),
    "import { defineJig } from './side-effect.js'\nexport default defineJig({})",
    "import { defineJig as make } from '@jigging/jig'\nexport default make({})",
    project('{ flows: [Infinity] }'),
    project('{ flows: [], flows: [] }'),
    project("{ flows: ['x',,] }"),
    binding("{ package: 'flows/a', settings: { roots: discover('flows') } }"),
  ]
  for (const source of sources)
    assert.throws(() => parseAuthoredModule(source), UnsupportedSourceError)
  assert.equal(globalThis[key], before)
})

test('literal records cannot change object prototypes and large inputs are refused', () => {
  const parsed = parseAuthoredModule(
    binding('{ package: "flows/a", settings: { "__proto__": { sourceGraphPolluted: true } } }'),
  )
  assert.equal(Object.getPrototypeOf(parsed.value.settings), null)
  assert.equal({}.sourceGraphPolluted, undefined)
  assert.throws(() => parseAuthoredModule(' '.repeat(512 * 1024 + 1)), /byte limit/)
  assert.throws(
    () => parseAuthoredModule(project('{ flows: ' + '['.repeat(70) + '0' + ']'.repeat(70) + ' }')),
    /nesting limit/,
  )
})

test('root scope keeps configured bindings distinct and redacts settings and grant policies', async () => {
  await fixture(
    {
      'jig.ts': project(
        `{ entrypoint: 'binding:root --input SECRET_ARGUMENT', flows: ['flows/root', 'flows/worker'], bindings: ['bindings/root.ts', 'bindings/first.ts', 'bindings/second.ts'] }`,
      ),
      'bindings/root.ts': binding(
        "{ package: 'flows/root', slots: { first: 'binding:first', second: 'binding:second' } }",
      ),
      'bindings/first.ts': binding(
        "{ package: 'flows/worker', settings: { token: 'SECRET_SETTING' }, slots: { native: { kind: 'acp', client: 'SECRET_CLIENT' } } }",
      ),
      'bindings/second.ts': binding(
        "{ package: 'flows/worker', settings: { token: 'SECOND_SECRET' }, slots: { native: { kind: 'command', run: 'SECRET_COMMAND' } } }",
      ),
      'flows/root/FLOW.meta.json': metadata({}),
      'flows/worker/FLOW.meta.json': metadata({}),
      'flows/root/FLOW.ts': "throw new Error('This implementation must never be imported')",
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.equal(graph.provenance.root, 'binding:root')
      assert.equal(graph.provenance.semantics, 'authored-composition')
      assert.equal(graph.provenance.approval, 'not-verified')
      assert.deepEqual(
        graph.nodes.filter((node) => node.packagePath === 'flows/worker').map((node) => node.id),
        ['binding:first', 'binding:second'],
      )
      assert.equal(graph.edges.length, 4)
      assert(graph.edges.every((edge) => edge.meaning === 'may-invoke'))
      assert.equal(
        graph.edges.find((edge) => edge.slot === 'first').location.path,
        'bindings/root.ts',
      )
      assert(!JSON.stringify(graph).includes('SECRET'))
      assert(!graph.nodes.some((node) => 'packageDigest' in node || 'runnable' in node))
    },
  )
})

test('package descriptions retain authored text and provenance without merging Binding identities', async () => {
  const description = 'Check a proposed route.\nKeep “review” and <details> as authored text.'
  await fixture(
    {
      'jig.ts': project(
        "{ flows: ['flows/worker'], bindings: ['bindings/first.ts', 'bindings/second.ts'] }",
      ),
      'bindings/first.ts': binding(
        "{ package: 'flows/worker', settings: { token: 'PRIVATE_SETTING' }, slots: { native: { kind: 'acp', client: 'PRIVATE_CLIENT' } } }",
      ),
      'bindings/second.ts': binding(
        "{ package: 'flows/worker', settings: { token: 'PRIVATE_SECOND' } }",
      ),
      'flows/worker/FLOW.meta.json': JSON.stringify({
        name: 'Shared worker',
        description,
        uses: {},
      }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory, { inventory: true })
      const methods = graph.nodes.filter((node) => node.kind === 'flow' || node.kind === 'binding')
      assert.deepEqual(
        methods.map((node) => [node.id, node.label]),
        [
          ['binding:first', 'first'],
          ['binding:second', 'second'],
          ['flow:flows/worker', 'Shared worker'],
        ],
      )
      for (const node of methods) {
        assert.equal(node.description, description)
        assert.equal(node.descriptionSource, 'package-metadata')
        assert.equal(node.packagePath, 'flows/worker')
      }
      assert.equal(methods[0].location.path, 'bindings/first.ts')
      assert.equal(methods[2].location.path, 'flows/worker/FLOW.meta.json')
      assert.deepEqual(
        graph.edges.map((edge) => [edge.source, edge.slot]),
        [['binding:first', 'native']],
      )
      assert(!JSON.stringify(graph).includes('PRIVATE_'))
      assert.equal(graph.warnings.length, 0)
    },
  )
})

test('description bounds count UTF-8 bytes and retain complete text at the limit', async () => {
  const description = '🧭'.repeat(1024)
  assert.equal(Buffer.byteLength(description), 4096)
  await fixture(
    {
      'jig.ts': project("{ flows: ['flows/worker'] }"),
      'flows/worker/FLOW.meta.json': JSON.stringify({ name: 'Worker', description }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.equal(graph.nodes[0].description, description)
      assert.equal(graph.nodes[0].descriptionSource, 'package-metadata')
      assert.equal(graph.warnings.length, 0)
    },
  )
})

test('malformed and oversized descriptions are omitted without discarding routes or requirements', async () => {
  const descriptions = [
    null,
    false,
    42,
    [],
    { value: 'PRIVATE_DESCRIPTION' },
    'x'.repeat(4097),
    '🧭'.repeat(1024) + 'x',
  ]
  for (const description of descriptions) {
    await fixture(
      {
        'jig.ts': project(
          "{ entrypoint: 'binding:root', flows: ['flows/root', 'flows/leaf'], bindings: ['bindings/root.ts'] }",
        ),
        'bindings/root.ts': binding(
          "{ package: 'flows/root', slots: { configured: 'flow:flows/leaf' } }",
        ),
        'flows/root/FLOW.meta.json': JSON.stringify({
          name: 'Root',
          description,
          uses: { declared: {} },
        }),
        'flows/leaf/FLOW.meta.json': metadata({}),
      },
      async (directory) => {
        const graph = await extractSourceGraph(directory)
        const root = graph.nodes.find((node) => node.id === 'binding:root')
        assert.equal(root.kind, 'binding')
        assert(!Object.hasOwn(root, 'description'))
        assert(!Object.hasOwn(root, 'descriptionSource'))
        assert.equal(graph.nodes.length, 3)
        assert.deepEqual(
          graph.edges.map((edge) => [edge.slot, edge.evidence]),
          [
            ['configured', 'source-slot'],
            ['declared', 'unmapped-use'],
          ],
        )
        assert.deepEqual(
          graph.warnings.filter((warning) => warning.code === 'INVALID_PACKAGE_DESCRIPTION'),
          [
            {
              code: 'INVALID_PACKAGE_DESCRIPTION',
              node: 'binding:root',
              message:
                'Authored package description omitted: expected a string of at most 4096 UTF-8 bytes',
            },
          ],
        )
        assert(
          !graph.warnings.some(
            (warning) =>
              warning.code === 'OPAQUE_PACKAGE' || warning.code === 'UNSUPPORTED_BINDING',
          ),
        )
        assert(!JSON.stringify(graph).includes('PRIVATE_DESCRIPTION'))
        const leaf = graph.nodes.find((node) => node.id === 'flow:flows/leaf')
        assert(!Object.hasOwn(leaf, 'description'))
        assert(!Object.hasOwn(leaf, 'descriptionSource'))
      },
    )
  }
})

test('unavailable metadata stays opaque and never supplies a description', async () => {
  const sources = [
    undefined,
    '{ invalid JSON',
    JSON.stringify({ description: 'Not supported', uses: [] }),
    JSON.stringify({ description: 'x'.repeat(512 * 1024) }),
  ]
  for (const source of sources) {
    await fixture(
      {
        'jig.ts': project("{ flows: ['flows/worker'], bindings: ['bindings/worker.ts'] }"),
        'bindings/worker.ts': binding("{ package: 'flows/worker' }"),
        ...(source === undefined ? {} : { 'flows/worker/FLOW.meta.json': source }),
      },
      async (directory) => {
        const graph = await extractSourceGraph(directory, { inventory: true })
        assert.deepEqual(
          graph.nodes.map((node) => node.kind),
          ['binding', 'flow'],
        )
        assert.equal(graph.edges.length, 0)
        for (const node of graph.nodes) {
          assert.match(node.reason, /metadata is unavailable/)
          assert(!Object.hasOwn(node, 'description'))
          assert(!Object.hasOwn(node, 'descriptionSource'))
        }
        assert.deepEqual(
          graph.warnings.map((warning) => warning.code),
          ['OPAQUE_PACKAGE', 'OPAQUE_PACKAGE'],
        )
      },
    )
  }
})

test('explicit membership excludes unselected declarations and direct Flows do not borrow Binding routes', async () => {
  await fixture(
    {
      'jig.ts': project("{ flows: ['flows/root', 'flows/child'], bindings: ['bindings/root.ts'] }"),
      'bindings/root.ts': binding(
        "{ package: 'flows/root', slots: { child: 'flow:flows/child' } }",
      ),
      'bindings/unselected.ts': "throw new Error('not selected')",
      'flows/root/FLOW.meta.json': metadata({ child: {} }),
      'flows/child/FLOW.meta.json': metadata({}),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory, { root: 'flow:flows/root' })
      assert.equal(graph.edges.length, 1)
      assert.equal(graph.nodes.find((node) => node.id === graph.edges[0].target).kind, 'unknown')
      assert(
        !graph.nodes.some((node) => node.id === 'binding:root' || node.id === 'binding:unselected'),
      )
      assert(!graph.warnings.some((warning) => warning.code === 'UNSUPPORTED_BINDING'))
    },
  )
})

test('contract-ID defaults are authored selections, explicit slots win, and npm code remains opaque', async () => {
  await fixture(
    {
      'jig.ts': project(
        "{ entrypoint: 'binding:root', flows: discover('flows'), bindings: discover('bindings'), defaultProviders: { 'https://example.test/agent': 'binding:agent' } }",
      ),
      'bindings/root.ts': binding(
        "{ package: 'flows/root', slots: { explicit: 'flow:flows/child' } }",
      ),
      'bindings/agent.ts': binding(
        "{ package: 'npm:@example/agent', slots: { native: { kind: 'acp', client: 'client' } } }",
      ),
      'flows/root/FLOW.meta.json': metadata({
        agent: { contract: './contracts/agent.json' },
        explicit: { contract: './contracts/agent.json' },
      }),
      'flows/root/FLOW.ts': "throw new Error('must not execute')",
      'flows/root/contracts/agent.json': JSON.stringify({
        id: 'https://example.test/agent',
        version: '0',
      }),
      'flows/child/FLOW.meta.json': metadata({}),
      'flows/child/FLOW.py': "raise RuntimeError('must not execute')",
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.equal(
        graph.edges.find((edge) => edge.source === 'binding:root' && edge.slot === 'agent').target,
        'binding:agent',
      )
      assert.equal(
        graph.edges.find((edge) => edge.slot === 'agent').evidence,
        'source-default-selection',
      )
      assert.equal(graph.edges.find((edge) => edge.slot === 'explicit').target, 'flow:flows/child')
      assert.equal(
        graph.nodes.find((node) => node.id === 'binding:agent').packagePath,
        'npm:@example/agent',
      )
      assert(graph.nodes.find((node) => node.id === 'binding:agent').reason.includes('opaque'))
      assert(graph.warnings.some((warning) => warning.code === 'DEFAULT_NOT_VERIFIED'))
    },
  )
})

test('missing contract files stay unresolved even when a default has a familiar name', async () => {
  await fixture(
    {
      'jig.ts': project(
        "{ entrypoint: 'binding:root', flows: ['flows/root'], bindings: ['bindings/root.ts'], defaultProviders: { 'https://example.test/agent': 'binding:agent' } }",
      ),
      'bindings/root.ts': binding("{ package: 'flows/root' }"),
      'flows/root/FLOW.meta.json': metadata({ agent: { contract: './missing.json' } }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.equal(graph.edges[0].evidence, 'unmapped-use')
      assert(
        graph.warnings.some((warning) =>
          warning.message.includes('contract identity is unavailable'),
        ),
      )
      assert(!graph.nodes.some((node) => node.id === 'binding:agent'))
    },
  )
})

test('attachment ports are retained, named grant contents are redacted, and no mount path is exported', async () => {
  await fixture(
    {
      'jig.ts': project(
        "{ entrypoint: 'binding:root', flows: discover('flows'), bindings: discover('bindings'), grants: discover('grants') }",
      ),
      'bindings/root.ts': binding(
        "{ package: 'flows/root', attachments: { source: 'PRIVATE_SOURCE' }, slots: { child: { target: 'flow:flows/child', attachments: { source: { from: 'source' }, files: { create: true } } }, web: 'grant:web' } }",
      ),
      'flows/root/FLOW.meta.json': metadata({}),
      'flows/root/FLOW.ts': "throw new Error('must not execute')",
      'flows/child/FLOW.meta.json': metadata({}),
      'flows/child/FLOW.ts': "throw new Error('must not execute')",
      'grants/web.json': JSON.stringify({
        kind: 'http',
        url: 'https://PRIVATE_ENDPOINT.test',
        secret: 'PRIVATE_TOKEN',
      }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.deepEqual(
        JSON.parse(JSON.stringify(graph.edges.find((edge) => edge.slot === 'child').attachments)),
        { source: { from: 'source' }, files: { create: true } },
      )
      assert.equal(graph.nodes.find((node) => node.kind === 'grant').grantKind, 'http')
      assert.equal(graph.nodes.find((node) => node.kind === 'grant').grantName, 'web')
      assert(!JSON.stringify(graph).includes('PRIVATE_'))
    },
  )
})

test('a dynamic selected Binding becomes an unknown node without partial extraction', async () => {
  await fixture(
    {
      'jig.ts': project(
        "{ entrypoint: 'binding:root', flows: ['flows/root'], bindings: ['bindings/root.ts'] }",
      ),
      'bindings/root.ts': binding("{ package: 'flows/root', slots: makeRoutes() }"),
      'flows/root/FLOW.meta.json': JSON.stringify({
        name: 'Root',
        description: 'Do not attach this to an unsupported declaration',
        uses: {},
      }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory)
      assert.equal(graph.nodes.length, 1)
      assert.equal(graph.nodes[0].kind, 'unknown')
      assert(!Object.hasOwn(graph.nodes[0], 'description'))
      assert(!Object.hasOwn(graph.nodes[0], 'descriptionSource'))
      assert.equal(graph.edges.length, 0)
      assert(graph.warnings.some((warning) => warning.code === 'UNSUPPORTED_BINDING'))
    },
  )
})

test('source discovery refuses symlinks and explicit traversal without reading outside the project', async () => {
  await fixture(
    {
      'jig.ts': project("{ flows: discover('flows'), bindings: [] }"),
      'outside/FLOW.meta.json': metadata({}),
    },
    async (directory) => {
      await symlink(path.join(directory, 'outside'), path.join(directory, 'flows'), 'dir')
      const graph = await extractSourceGraph(directory)
      assert.equal(graph.nodes.length, 0)
      assert(graph.warnings.some((warning) => warning.code === 'DISCOVERY_UNAVAILABLE'))
      await writeFile(
        path.join(directory, 'jig.ts'),
        project("{ flows: ['../outside'], bindings: [] }"),
      )
      await assert.rejects(extractSourceGraph(directory), /inside ordinary authored source/)
    },
  )
})

test('discovery follows Jig immediate-child membership and requires exact FLOW entrypoints', async () => {
  await fixture(
    {
      'jig.ts': project(
        "{ flows: discover(['flows', 'missing-flows']), bindings: discover('bindings'), grants: discover('grants') }",
      ),
      'flows/FLOW.ts': "throw new Error('discovery must not select its root')",
      'flows/current/FLOW.ts': "throw new Error('must not execute')",
      'flows/current/FLOW.meta.json': metadata({}),
      'flows/python/FLOW.py': "raise RuntimeError('must not execute')",
      'flows/python/FLOW.meta.json': metadata({}),
      'flows/markdown/FLOW.md': '# A portable method\n',
      'flows/archive/old/FLOW.ts': "throw new Error('nested archive is not a member')",
      'flows/archive/old/FLOW.meta.json': metadata({}),
      'flows/metadata-only/FLOW.meta.json': metadata({}),
      'flows/contracts-only/FLOW.contract.json': '{}',
      'flows/wrong-case/flow.ts': "throw new Error('wrong-case marker')",
      'bindings/current.ts': binding(
        "{ package: 'flows/current', slots: { web: 'grant:current' } }",
      ),
      'bindings/archive/old.ts': "throw new Error('nested binding is not selected')",
      'grants/current.json': JSON.stringify({ kind: 'http', url: 'https://example.test' }),
      'grants/archive/old.json': JSON.stringify({
        kind: 'http',
        url: 'https://archive.example.test',
      }),
    },
    async (directory) => {
      const graph = await extractSourceGraph(directory, { inventory: true })
      assert.deepEqual(
        graph.nodes.filter((node) => node.kind === 'flow').map((node) => node.id),
        ['flow:flows/current', 'flow:flows/markdown', 'flow:flows/python'],
      )
      assert.deepEqual(
        graph.nodes.filter((node) => node.kind === 'binding').map((node) => node.id),
        ['binding:current'],
      )
      assert.equal(graph.nodes.find((node) => node.kind === 'grant').grantName, 'current')
      assert(!JSON.stringify(graph).includes('archive'))
      assert(!graph.warnings.some((warning) => warning.code === 'DISCOVERY_UNAVAILABLE'))
      assert(
        graph.nodes.find((node) => node.id === 'flow:flows/markdown').reason.includes('opaque'),
      )
    },
  )
})

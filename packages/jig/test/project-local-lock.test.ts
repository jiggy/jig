import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  AGENT_RUN_CONTRACT_DIGEST,
  AGENT_RUN_CONTRACT_ID,
  AGENT_RUN_CONTRACT_VERSION,
} from '../src/internal/private-agent-run.js'
import {
  createPrivateProjectLocalLock,
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
  requirePrivateProjectLocalLock,
} from '../src/internal/project-local-lock.js'
import { canonicalJson, JSON_1_LIMITS, type JsonValue } from '../src/json.js'
import { defineJig } from '../src/project/author.js'
import { captureFlowSource } from '../src/project/flow-source.js'
import {
  type InjectedBindingDeclaration,
  linkPackageProject,
  type PackageProjectValue,
} from '../src/project/package-project.js'
import {
  buildPrivateActivationRequests,
  restorePrivateActivationRequest,
} from '../src/project/package-resolution.js'
import { type RetainedFlowInput, retainFlowSourcePackages } from '../src/project/retained-flow.js'

const encoder = new TextEncoder()
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

describe('private package-project portable lock projection', () => {
  test('checkpoint authority is exact, root-only, and retained in lock identity', async () => {
    const descriptor = await readFile(
      new URL('../../../docs/jig/spec/contracts/run-checkpoint/contract.json', import.meta.url),
      'utf8',
    )
    for (const attachments of [{ out: 'read-write' }, {}]) {
      await withFlows(
        {
          'flows/checkpoint': {
            'flow.meta.json': metadata({
              name: 'checkpoint',
              description: 'Save progress.',
              uses: { progress: { contract: './contracts/run-checkpoint/contract.json' } },
            }),
            'FLOW.contract.json': JSON.stringify({
              $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
              attachments,
            }),
            'FLOW.ts': 'export {};\n',
            'contracts/run-checkpoint/contract.json': descriptor,
          },
          'flows/parent': {
            'flow.meta.json': metadata({ name: 'parent', description: 'Parent.' }),
            'FLOW.ts': 'export {};\n',
          },
        },
        async (flows) => {
          if (!Object.hasOwn(attachments, 'out')) {
            expect(() => linkPackageProject({ flows, bindings: [] })).toThrow('writable attachment')
            return
          }
          const project = linkPackageProject({ flows, bindings: [] })
          const lock = createPrivateProjectLocalLock(project)
          expect(lock.packages['flows/checkpoint']!.directRun).toBe(true)
          expect(lock.packages['flows/checkpoint']!.uses.progress!.id).toBe(
            'https://jig.md/contracts/run-checkpoint',
          )
          expect(decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock))).toEqual(lock)
          expect(() =>
            linkPackageProject({
              flows,
              bindings: [
                binding('bindings/parent.ts', {
                  package: 'flows/parent',
                  slots: { child: 'flow:flows/checkpoint' },
                }),
              ],
            }),
          ).toThrow()
        },
      )
    }
  })
  test('has one empty canonical byte vector and authenticated identity', () => {
    const bytes = encoder.encode('{"bindings":{},"packages":{}}\n')
    const value = decodePrivateProjectLocalLock(bytes)

    expect(encodePrivateProjectLocalLock(value)).toEqual(bytes)
    expect(privateProjectLocalLockDigest(value)).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(requirePrivateProjectLocalLock(value)).toBe(value)
    expect(Object.isFrozen(value)).toBeTrue()
    expect(Object.isFrozen(value.packages)).toBeTrue()
    expect(() => requirePrivateProjectLocalLock(structuredClone(value))).toThrow(
      'was not built or strictly decoded',
    )
  })

  test('projects exact packages and Binding settings', async () => {
    await withFlows(projectTrees(), async (flows) => {
      const project = linkedProject(flows, 3)
      const lock = createPrivateProjectLocalLock(project)
      expect(() => createPrivateProjectLocalLock(structuredClone(project))).toThrow(
        'not produced by the package-project linker',
      )

      expect(lock.packages['flows/configured']).toMatchObject({
        directRun: false,
        uses: {},
      })
      expect(lock.packages['flows/worker']).toMatchObject({
        directRun: true,
        uses: {},
      })
      expect(lock.bindings.configured).toEqual({
        packagePath: 'flows/configured',
        settings: { maxRetries: 3 },
        slots: { worker: { kind: 'flow', path: 'flows/worker' } },
      })

      const encoded = encodePrivateProjectLocalLock(lock)
      const decoded = decodePrivateProjectLocalLock(encoded)
      expect(encodePrivateProjectLocalLock(decoded)).toEqual(encoded)
      expect(privateProjectLocalLockDigest(decoded)).toBe(privateProjectLocalLockDigest(lock))
      expect(Object.isFrozen(decoded.packages['flows/configured'])).toBeTrue()
      expect(Object.isFrozen(decoded.bindings.configured)).toBeTrue()
    })
  })

  test('canonically orders slots and changes identity for add, remove, and retarget', async () => {
    await withFlows(projectTrees(), async (flows) => {
      const base = createPrivateProjectLocalLock(
        linkedProject(flows, 3, {
          worker: 'flow:flows/worker',
        }),
      )
      const reordered = createPrivateProjectLocalLock(
        linkedProject(flows, 3, {
          worker: 'flow:flows/worker',
          backup: 'flow:flows/backup',
        }),
      )
      expect(Object.keys(reordered.bindings.configured!.slots)).toEqual(['backup', 'worker'])

      const variants = [
        createPrivateProjectLocalLock(linkedProject(flows, 3, {})),
        reordered,
        createPrivateProjectLocalLock(
          linkedProject(flows, 3, {
            worker: 'flow:flows/backup',
          }),
        ),
      ]
      for (const variant of variants) {
        expect(encodePrivateProjectLocalLock(variant)).not.toEqual(
          encodePrivateProjectLocalLock(base),
        )
        expect(privateProjectLocalLockDigest(variant)).not.toBe(privateProjectLocalLockDigest(base))
      }
    })
  })

  test('projects exact interface requirements without granting native authority during lock decode', async () => {
    await withFlows(
      {
        'flows/router': {
          'flow.meta.json': metadata({
            name: 'router',
            description: 'Router.',
            uses: { agent: { contract: './contracts/agent-run/contract.json' } },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/agent-run/contract.json': agentRunContract,
          'contracts/agent-run/contracts/acp-public-updates.json': acpPublicUpdates,
        },
      },
      async (flows) => {
        const lock = createPrivateProjectLocalLock(linkPackageProject({ flows, bindings: [] }))
        expect(lock.packages['flows/router']!.uses).toEqual({
          agent: {
            id: AGENT_RUN_CONTRACT_ID,
            version: AGENT_RUN_CONTRACT_VERSION,
            digest: AGENT_RUN_CONTRACT_DIGEST,
          },
        })
        expect(Object.isFrozen(lock.packages['flows/router']!.uses.agent)).toBeTrue()
        const decoded = decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock))
        expect(decoded).toEqual(lock)
        const changed = structuredClone(lock)
        ;(changed.packages['flows/router']!.uses.agent as { version: string }).version = '2.0.0'
        const changedDecoded = decodePrivateProjectLocalLock(lockBytes(changed))
        expect(changedDecoded.packages['flows/router']!.uses.agent!.version).toBe('2.0.0')
        expect(privateProjectLocalLockDigest(changedDecoded)).not.toBe(
          privateProjectLocalLockDigest(lock),
        )
      },
    )
  })

  test('retains reviewed command authority in lock and activation identity', async () => {
    const commandContract = await readFile(
      new URL('../../../docs/jig/spec/contracts/project-command/contract.json', import.meta.url),
      'utf8',
    )
    await withFlows(
      {
        'flows/command': {
          'flow.meta.json': metadata({
            name: 'command',
            description: 'Command.',
            uses: { command: { contract: './contracts/project-command/contract.json' } },
          }),
          'FLOW.ts': 'export {};\n',
          'contracts/project-command/contract.json': commandContract,
        },
      },
      async (flows) => {
        const project = (run: string) =>
          linkPackageProject({
            flows,
            bindings: [
              binding('bindings/command.ts', {
                package: 'flows/command',
                slots: { command: { kind: 'command', run } },
              }),
            ],
          })
        const first = project('src/cli.ts'),
          second = project('src/other.ts')
        const lock = createPrivateProjectLocalLock(first)
        expect(lock.bindings.command!.slots.command).toEqual({
          kind: 'grant',
          policy: { kind: 'command', run: 'src/cli.ts' },
        })
        expect(decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock))).toEqual(lock)
        expect(privateProjectLocalLockDigest(createPrivateProjectLocalLock(second))).not.toBe(
          privateProjectLocalLockDigest(lock),
        )
        const request = buildPrivateActivationRequests(first).find(
          (r) => r.target.kind === 'binding',
        )!
        expect(restorePrivateActivationRequest(structuredClone(request))).toEqual(request)
        expect(
          buildPrivateActivationRequests(second).find((r) => r.target.kind === 'binding')!.digest,
        ).not.toBe(request.digest)
        expect(() =>
          restorePrivateActivationRequest({
            ...request,
            slots: {
              ...request.slots,
              command: {
                ...request.slots.command,
                grant: { kind: 'command', run: 'src/other.ts' },
              },
            },
          }),
        ).toThrow()
        expectInvalid(
          lock,
          (value) => {
            value.bindings.command.slots.command.policy = { kind: 'command', shell: 'bun test' }
          },
          'run or test',
        )
      },
    )
  })

  test('retains configured Agent child identity and rejects widened slot relations on decode', async () => {
    await withFlows(projectTrees(), async (flows) => {
      const lock = createPrivateProjectLocalLock(
        linkPackageProject({
          flows,
          bindings: [
            binding('bindings/router.ts', {
              package: 'flows/worker',
              slots: { review: 'binding:reviewer' },
            }),
            binding('bindings/reviewer.ts', {
              package: 'flows/configured',
              settings: { maxRetries: 7 },
            }),
          ],
        }),
      )
      const value = JSON.parse(new TextDecoder().decode(encodePrivateProjectLocalLock(lock)))
      value.packages['flows/configured'].uses = {
        agent: {
          id: AGENT_RUN_CONTRACT_ID,
          version: AGENT_RUN_CONTRACT_VERSION,
          digest: AGENT_RUN_CONTRACT_DIGEST,
        },
      }
      const decoded = decodePrivateProjectLocalLock(lockBytes(value))
      expect(decoded.bindings.router!.slots.review).toEqual({ kind: 'binding', id: 'reviewer' })
      expect(Object.isFrozen(decoded.bindings.router!.slots.review)).toBeTrue()
      expect(decoded.bindings.reviewer!.settings).toEqual({ maxRetries: 7 })
      const base = value
      expectInvalid(
        base,
        (item) => {
          item.bindings.router.slots.review = 'flows/configured'
        },
        'must be an object',
      )
      expectInvalid(
        base,
        (item) => {
          item.bindings.router.slots.review = { kind: 'binding', id: 'missing' }
        },
        'unknown Binding',
      )
      expectInvalid(
        base,
        (item) => {
          item.bindings.router.slots.review = { kind: 'binding', id: 'router' }
        },
        'own package',
      )
      expectInvalid(
        base,
        (item) => {
          item.bindings.router.slots.review = {
            kind: 'binding',
            id: 'reviewer',
            path: 'flows/configured',
          }
        },
        'must contain exactly',
      )
      expectInvalid(
        base,
        (item) => {
          item.bindings.reviewer.slots = { nested: { kind: 'flow', path: 'flows/backup' } }
        },
        'Binding with child slots',
      )
      expectInvalid(
        base,
        (item) => {
          item.bindings.reviewer.slots = { nested: { kind: 'binding', id: 'router' } }
        },
        'Binding with child slots',
      )
    })
  })

  test('changes when package bytes or Binding settings change', async () => {
    let first: Uint8Array | undefined
    await withFlows(projectTrees(), async (flows) => {
      first = encodePrivateProjectLocalLock(createPrivateProjectLocalLock(linkedProject(flows, 3)))
      const changedSettings = encodePrivateProjectLocalLock(
        createPrivateProjectLocalLock(linkedProject(flows, 9)),
      )
      expect(changedSettings).not.toEqual(first)
    })

    const changed = projectTrees()
    changed['flows/worker']!['FLOW.ts'] = 'export const changed = true;\n'
    await withFlows(changed, async (flows) => {
      const second = encodePrivateProjectLocalLock(
        createPrivateProjectLocalLock(linkedProject(flows, 3)),
      )
      expect(second).not.toEqual(first!)
    })
  })

  test('rejects alternate spelling and forged fields', () => {
    const canonical = {
      packages: {},
      bindings: {},
    }
    const valid = lockBytes(canonical)
    expect(() => decodePrivateProjectLocalLock(valid)).not.toThrow()
    expect(() => decodePrivateProjectLocalLock(valid.subarray(0, valid.length - 1))).toThrow(
      'not in canonical',
    )
    expect(() =>
      decodePrivateProjectLocalLock(encoder.encode(JSON.stringify(canonical, null, 2) + '\n')),
    ).toThrow('not in canonical')
    expect(() =>
      decodePrivateProjectLocalLock(
        encoder.encode('{"packages":{},"packages":{},"bindings":{}}\n'),
      ),
    ).toThrow('duplicate object member')
    expect(() =>
      decodePrivateProjectLocalLock(
        lockBytes({
          ...canonical,
          backend: { digest: `sha256:${'a'.repeat(64)}` },
        }),
      ),
    ).toThrow('must contain exactly')
    expect(() =>
      decodePrivateProjectLocalLock(Uint8Array.from([0xef, 0xbb, 0xbf, ...valid])),
    ).toThrow('BOM is not allowed')
  })

  test('strict decoding rejects corrupt packages and dangling Binding relations', async () => {
    await withFlows(projectTrees(), async (flows) => {
      const base = structuredClone(createPrivateProjectLocalLock(linkedProject(flows, 3))) as any

      expectInvalid(
        base,
        (value) => {
          value.packages['flows/worker'].digest = `sha256:${'A'.repeat(64)}`
        },
        'digest must be sha256',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.packagePath = 'flows/missing'
        },
        'selects an unknown package',
      )
      expectInvalid(
        base,
        (value) => {
          value.packages['FLOWS/WORKER'] = value.packages['flows/worker']
        },
        'collide',
      )
      expectInvalid(
        base,
        (value) => {
          value.packages['.JIG/worker'] = value.packages['flows/worker']
        },
        'protected .jig',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.packagePath = '.jig/configured'
        },
        'protected .jig',
      )
      expectInvalid(
        base,
        (value) => {
          delete value.bindings.configured.slots
        },
        'must contain exactly',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = []
        },
        'slots must be an object',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = { Bad: { kind: 'flow', path: 'flows/worker' } }
        },
        'must be a LocalName',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = { worker: { kind: 'flow', path: '../worker' } }
        },
        'invalid path segment',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = Object.fromEntries(
            Array.from({ length: 257 }, (_, index) => [`slot-${index}`, 'flows/worker']),
          )
        },
        'exceed 256 entries',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = { worker: { kind: 'flow', path: 'flows/missing' } }
        },
        'selects an unknown package',
      )
      expectInvalid(
        base,
        (value) => {
          value.bindings.configured.slots = { worker: { kind: 'flow', path: 'flows/configured' } }
        },
        'selects its own package',
      )
      expectInvalid(
        base,
        (value) => {
          value.packages['flows/worker'].directRun = false
        },
        'must select a direct Run package or configured Binding',
      )
      expectInvalid(
        base,
        (value) => {
          value.packages['flows/configured'].unexpected = true
        },
        'must contain exactly',
      )
    })
  })

  test('enforces the aggregate activation-target bound', () => {
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(257)))).not.toThrow()
    expect(() => decodePrivateProjectLocalLock(lockBytes(rootPackageCollection(4_097)))).toThrow(
      'activation targets exceed 4096 targets',
    )
  })

  test('enforces the JSON/1 file-byte ceiling', () => {
    expect(() => decodePrivateProjectLocalLock(new Uint8Array(JSON_1_LIMITS.bytes + 1))).toThrow(
      'maximum bytes exceeded',
    )
  })
})

function rootPackageCollection(count: number): unknown {
  const packages = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `flows/item-${index}`,
      {
        digest: `sha256:${'e'.repeat(64)}`,
        directRun: true,
        uses: {},
      },
    ]),
  )
  return { packages, bindings: {} }
}

function projectTrees(): Record<string, Record<string, string>> {
  return {
    'flows/configured': {
      'flow.meta.json': metadata({ name: 'configured', description: 'Configured.' }),
      'FLOW.ts': 'export {};\n',
      'settings.schema.json': schema({
        type: 'object',
        properties: { maxRetries: { type: 'integer' } },
        required: ['maxRetries'],
        additionalProperties: false,
      }),
    },
    'flows/worker': {
      'flow.meta.json': metadata({ name: 'worker', description: 'Worker.' }),
      'FLOW.ts': 'export {};\n',
    },
    'flows/backup': {
      'flow.meta.json': metadata({ name: 'backup', description: 'Backup.' }),
      'FLOW.ts': 'export {};\n',
    },
  }
}

function linkedProject(
  flows: readonly RetainedFlowInput[],
  maxRetries: number,
  slots: Readonly<Record<string, string>> = { worker: 'flow:flows/worker' },
): PackageProjectValue {
  return linkPackageProject({
    flows,
    bindings: [
      binding('bindings/configured.ts', {
        package: 'flows/configured',
        settings: { maxRetries },
        slots,
      }),
    ],
  })
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

async function withFlows(
  trees: Readonly<Record<string, Readonly<Record<string, string>>>>,
  action: (flows: readonly RetainedFlowInput[]) => Promise<void> | void,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'jig-project-lock-'))
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

function lockBytes(value: unknown): Uint8Array {
  const body = canonicalJson(value as JsonValue)
  const bytes = new Uint8Array(body.length + 1)
  bytes.set(body)
  bytes[body.length] = 0x0a
  return bytes
}

function expectInvalid(base: unknown, change: (value: any) => void, message: string): void {
  const value = structuredClone(base)
  change(value)
  expect(() => decodePrivateProjectLocalLock(lockBytes(value))).toThrow(message)
}

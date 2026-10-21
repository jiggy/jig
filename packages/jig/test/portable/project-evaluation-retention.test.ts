import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureBoundAttachments } from '../../src/internal/bound-attachments.js'
import { EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT } from '../../src/internal/bun-execution-layout.js'
import { grantChanges, requiresAuthorityApproval } from '../../src/internal/grant-review.js'
import { privateDomainDigest } from '../../src/internal/identity.js'
import {
  captureStoredPackage,
  normalizePackageArtifactRef,
  publishCapturedPackage,
} from '../../src/internal/package-artifact-store.js'
import {
  normalizePrivateProjectEvaluationCompiler,
  PROJECT_EVALUATION_LIMITS,
} from '../../src/internal/project-evaluation-policy.js'
import {
  normalizePrivateRetainedProjectEvaluation,
  openPrivateRetainedProjectEvaluation,
} from '../../src/internal/project-evaluation-retention.js'
import { reviewPrivateProjectEvaluation } from '../../src/internal/project-evaluation-review.js'
import {
  decodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from '../../src/internal/project-local-lock.js'
import { canonicalJson, type JsonValue } from '../../src/json.js'
import { createCapturedPackage } from '../../src/package/capture.js'
import { packageDigest } from '../../src/package/digest.js'
import { defineBinding } from '../../src/project/author.js'
import { normalizeInvocationSlots } from '../../src/project/invocation-slots.js'
import { restorePrivateActivationRequest } from '../../src/project/package-resolution.js'
import { openPrivateProjectRoot } from '../../src/project/root.js'
import { compileSchemaFile } from '../../src/schema/index.js'

const grant = {
  kind: 'evaluation' as const,
  recipe: 'evaluation/parser',
  attachments: { candidate: 'supplied-read' as const, deliverables: 'operation-create' as const },
}
const recipe = {
  family: 'bun-typescript' as const,
  test: ['test/parser.test.ts'],
  collect: ['dist' as const],
}
const compiler = normalizePrivateProjectEvaluationCompiler(
  { compilerOptions: { strict: true } },
  new Set(),
)
const contract = {
  id: 'https://jig.md/contracts/project-evaluation',
  version: '0.1.0',
  digest: 'sha256:34de8dfd2f60e4fd6dfdd884a2acb1deba0e3f8e27191fdc38d05b3e9edd7192',
}
const sha256 = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
async function captured(contents: Record<string, string>) {
  const entries = Object.entries(contents).sort(([a], [b]) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  )
  const values = new Map(entries.map(([path, value]) => [path, Buffer.from(value)]))
  const files = entries.map(([path]) => ({ path, size: values.get(path)!.length }))
  const stream = async function* (path: string) {
    yield values.get(path)!
  }
  return createCapturedPackage(
    'evaluation test',
    files,
    await packageDigest(files, (file) => stream(file.path)),
    {
      stream,
      async dispose() {},
    },
  )
}
async function fixture(work: (directory: string, store: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'jig-evaluation-retention-')))
  const store = join(directory, '.store')
  await mkdir(store, { mode: 0o700 })
  try {
    await work(directory, store)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function operands(store: string) {
  const r = await captured({
    'evaluation.json': JSON.stringify(recipe),
    'package.json': '{"devDependencies":{"typescript":"5.7.3"}}',
    'bun.lock': '{"lockfileVersion":1}',
    'tsconfig.json': '{"compilerOptions":{"strict":true}}',
  })
  const d = await captured({ 'node_modules/typescript/lib/tsc.js': 'exact compiler bytes' })
  const { kind: _, ...policy } = grant
  const metadata = normalizePrivateRetainedProjectEvaluation({
    recipe: await publishCapturedPackage(store, r),
    dependencies: await publishCapturedPackage(store, d),
    recipeDigest: privateDomainDigest('JIG-Project-Evaluation-Recipe/1', {
      captureDigest: r.digest,
      grant: policy,
      recipe,
      compiler,
      limits: PROJECT_EVALUATION_LIMITS,
    } as unknown as JsonValue),
    dependencyDigest: privateDomainDigest('JIG-Project-Evaluation-Dependencies/1', {
      files: await Promise.all(
        d.files.map(async (file) => ({
          path: file.path,
          bytes: file.size,
          digest: sha256(await d.read(file.path, file.size)),
        })),
      ),
      layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
      classification: 'development-inclusive',
    } as unknown as JsonValue),
    layout: EMPTY_PRIVATE_BUN_EXECUTION_LAYOUT,
    configuration: { recipe, compiler },
  })
  await Promise.all([r.dispose(), d.dispose()])
  return metadata
}

test('evaluation attachment authority is inert grant policy, not a Binding route map', async () => {
  const binding = defineBinding({ package: 'flows/check', slots: { evaluate: grant } })
  expect(binding.slots.evaluate).toEqual(grant)
  expect(Object.isFrozen(binding.slots.evaluate)).toBe(true)
  const schema = compileSchemaFile(
    await readFile(
      new URL('../../../../docs/jig/spec/machine/project-authoring-1.schema.json', import.meta.url),
    ),
    'project-authoring-1.schema.json',
  )
  expect(() => schema.validate(binding, 'INVALID_PROJECT_AUTHORING')).not.toThrow()
  const invalid = structuredClone(binding)
  ;(
    invalid.slots.evaluate as unknown as { attachments: { candidate: string } }
  ).attachments.candidate = 'read-write'
  expect(() => schema.validate(invalid, 'INVALID_PROJECT_AUTHORING')).toThrow()
})

test('review refuses oversized recipes and compiler plugins before preparation', async () => {
  const { kind: _, ...policy } = grant
  const excess = await captured(
    Object.fromEntries(Array.from({ length: 33 }, (_, n) => [`${n}.json`, '{}'])),
  )
  try {
    await expect(
      reviewPrivateProjectEvaluation({ captured: excess, grant: policy } as never),
    ).rejects.toThrow()
  } finally {
    await excess.dispose()
  }
  const plugin = await captured({
    'evaluation.json': JSON.stringify(recipe),
    'package.json': '{}',
    'bun.lock': '{}',
    'tsconfig.json': '{"compilerOptions":{"plugins":[{"name":"ambient"}]}}',
  })
  try {
    await expect(
      reviewPrivateProjectEvaluation({ captured: plugin, grant: policy } as never),
    ).rejects.toThrow()
  } finally {
    await plugin.dispose()
  }
})

test(
  'retained R/D survives source removal and refuses changed grant, compiler, bytes and layout',
  async () =>
    fixture(async (_directory, store) => {
      const metadata = await operands(store)
      const original = await openPrivateRetainedProjectEvaluation(store, metadata, grant)
      expect(await original.dependencies.read('node_modules/typescript/lib/tsc.js', 100)).toEqual(
        Buffer.from('exact compiler bytes'),
      )
      await original.dispose()
      for (const changed of [
        { ...metadata, recipeDigest: `sha256:${'0'.repeat(64)}` },
        { ...metadata, dependencyDigest: `sha256:${'0'.repeat(64)}` },
        {
          ...metadata,
          configuration: {
            ...metadata.configuration,
            compiler: normalizePrivateProjectEvaluationCompiler(
              { compilerOptions: { strict: false } },
              new Set(),
            ),
          },
        },
        { ...metadata, layout: { flowRoot: '', members: ['missing'], aliases: [] } },
      ])
        await expect(openPrivateRetainedProjectEvaluation(store, changed, grant)).rejects.toThrow()
      await expect(
        openPrivateRetainedProjectEvaluation(store, metadata, {
          ...grant,
          recipe: 'evaluation/other',
        }),
      ).rejects.toThrow()
      const hex = metadata.dependencies.digest.slice(7)
      const path = join(store, 'packages/v1/sha256', hex.slice(0, 2), `${hex.slice(2)}.pkg`)
      await chmod(path, 0o600)
      await writeFile(path, 'corrupt immutable retained bytes')
      await expect(openPrivateRetainedProjectEvaluation(store, metadata, grant)).rejects.toThrow()
    }),
  15_000,
)

test('evaluation metadata strict decoding rejects foreign fields, compiler authority and malformed layouts', async () =>
  fixture(async (_directory, store) => {
    const value = await operands(store)
    for (const changed of [
      { ...value, extra: true },
      { ...value, recipe: { ...value.recipe, configuration: {} } },
      { ...value, layout: { ...value.layout, extra: true } },
      {
        ...value,
        configuration: {
          ...value.configuration,
          compiler: {
            ...value.configuration.compiler,
            compilerOptions: { rootDir: '/', outDir: 'dist', plugins: ['ambient'] },
          },
        },
      },
    ])
      expect(() => normalizePrivateRetainedProjectEvaluation(changed)).toThrow()
    let read = false
    const accessor = { ...value }
    Object.defineProperty(accessor, 'recipe', {
      enumerable: true,
      get() {
        read = true
        return value.recipe
      },
    })
    expect(() => normalizePrivateRetainedProjectEvaluation(accessor)).toThrow()
    expect(read).toBe(false)
  }))

test('compiler, dependency and recipe changes affect the retained lock and exact activation request', async () =>
  fixture(async (_directory, store) => {
    const metadata = await operands(store)
    const lock = (evaluation: typeof metadata) =>
      decodePrivateProjectLocalLock(
        Buffer.from(
          Buffer.from(
            canonicalJson({
              packages: {
                'flows/check': {
                  digest: metadata.recipe.digest,
                  directRun: false,
                  uses: { evaluate: contract },
                },
              },
              bindings: {
                check: {
                  packagePath: 'flows/check',
                  settings: {},
                  slots: {
                    evaluate: { kind: 'grant', policy: grant, evaluation },
                  },
                },
              },
            } as unknown as JsonValue),
          ).toString() + '\n',
        ),
      )
    const request = (evaluation: typeof metadata) => {
      const content = {
        kind: 'activation-request/4',
        target: { kind: 'binding', id: 'check' },
        mode: 'run',
        packagePath: 'flows/check',
        package: metadata.recipe,
        entrypoint: { path: 'FLOW.ts', suffix: 'ts' },
        settings: {},
        attachments: {},
        slots: {
          evaluate: { kind: 'native', native: 'project-evaluation', contract, grant, evaluation },
        },
      }
      return restorePrivateActivationRequest({
        ...content,
        digest: privateDomainDigest('JIG-Activation-Request/4', content as unknown as JsonValue),
      })
    }
    const first = lock(metadata)
    const schema = compileSchemaFile(
      await readFile(
        new URL('../../../../docs/jig/spec/machine/jig-lock-1.schema.json', import.meta.url),
      ),
      'jig-lock-1.schema.json',
    )
    expect(() => schema.validate(first, 'INVALID_JIG_LOCK')).not.toThrow()
    const route = normalizeInvocationSlots({
      evaluate: {
        kind: 'native',
        native: 'project-evaluation',
        contract,
        grant,
        evaluation: metadata,
      },
    }).evaluate!
    expect(route.kind).toBe('native')
    for (const changed of [
      { ...metadata, recipeDigest: `sha256:${'1'.repeat(64)}` },
      { ...metadata, dependencyDigest: `sha256:${'2'.repeat(64)}` },
      {
        ...metadata,
        configuration: {
          ...metadata.configuration,
          compiler: normalizePrivateProjectEvaluationCompiler(
            { compilerOptions: { strict: false } },
            new Set(),
          ),
        },
      },
    ]) {
      expect(privateProjectLocalLockDigest(lock(changed))).not.toBe(
        privateProjectLocalLockDigest(first),
      )
      expect(request(changed).digest).not.toBe(request(metadata).digest)
      expect(requiresAuthorityApproval(first, lock(changed))).toBe(true)
      const changes = grantChanges(first, lock(changed))
      expect(changes[0]!.recipient).toBe('binding:check/evaluate')
      expect(changes[0]!.after!.evaluation!.configuration).toEqual(changed.configuration)
    }
    expect(requiresAuthorityApproval(first, lock(metadata))).toBe(false)
  }))

test('recipe capture retains exact immutable regular files and refuses symlinks without following them', async () =>
  fixture(async (directory, store) => {
    await mkdir(join(directory, 'evaluation/parser'), { recursive: true })
    await writeFile(join(directory, 'evaluation/parser/evaluation.json'), JSON.stringify(recipe))
    const root = await openPrivateProjectRoot(directory)
    try {
      const first = await captureBoundAttachments(root, { recipe: grant.recipe }, store)
      await writeFile(join(directory, 'evaluation/parser/evaluation.json'), 'changed')
      const retained = await captureStoredPackage(
        store,
        normalizePackageArtifactRef({ kind: 'flow-package/0', digest: first.recipe!.digest }),
      )
      try {
        expect(
          JSON.parse(Buffer.from(await retained.read('evaluation.json', 1024)).toString()),
        ).toEqual(recipe)
      } finally {
        await retained.dispose()
      }
      await symlink('/etc/passwd', join(directory, 'evaluation/parser/ambient.json'))
      await expect(captureBoundAttachments(root, { recipe: grant.recipe }, store)).rejects.toThrow()
    } finally {
      await root.dispose()
    }
  }))

import { afterEach, expect, test } from 'bun:test'
import { constants } from 'node:fs'
import { mkdir, mkdtemp, open, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { capturePackageDirectory } from '../src/package/capture.js'
import { openPrivateProjectRoot } from '../src/project/root.js'
import { prepareContractGeneration } from '../src/internal/contract-generation.js'
import { generateContract } from '../src/internal/contract-authoring-client.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

test('real bundled compiler publishes contracts through the host manager', async () => {
  const root = await fixture()
  await writeFile(
    join(root, 'flow/FLOW.contract.tsp'),
    'import "@jigging/flow-authoring/typespec"; using FLOW; @invocation(Input,Result) namespace Demo; @closed model Input { name:string; } @closed model Result {outcome:"done"; output:string;}',
  )
  await prepare(root, true, {
    compile: (source, signal) =>
      generateContract(
        source,
        signal,
        fileURLToPath(
          new URL('../libexec/authoring/contract-authoring-worker.js', import.meta.url),
        ),
      ),
  })
  expect(
    JSON.parse(await readFile(join(root, 'flow/FLOW.contract.json'), 'utf8')).input,
  ).toBeDefined()
  expect(await prepare(root, false)).toBe(false)
}, 30000)
const descriptor = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/invocation-contract-1.schema.json',
  input: true,
  result: true,
})
const projection = JSON.stringify({
  $schema: 'https://flow.jig.md/schemas/schema-1.json',
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: { text: { type: 'string' } },
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jig-generation-'))
  roots.push(root)
  await mkdir(join(root, '.jig'))
  await mkdir(join(root, 'flow'))
  await writeFile(join(root, 'flow/FLOW.ts'), '// inert fixture')
  await writeFile(join(root, 'flow/FLOW.contract.tsp'), 'first')
  return root
}
async function prepare(
  root: string,
  generate = true,
  overrides: Partial<Parameters<typeof prepareContractGeneration>[0]> = {},
) {
  const project = await openPrivateProjectRoot(root)
  const directory = await open(join(root, 'flow'), constants.O_RDONLY | constants.O_DIRECTORY)
  const captured = await capturePackageDirectory(join(root, 'flow'))
  try {
    return await prepareContractGeneration({
      project,
      generate,
      signal: new AbortController().signal,
      verify: () => project.verify(),
      compile: async (source) => ({
        source,
        artifacts: {
          'FLOW.contract.json': descriptor,
          'answer.schema.json': projection,
          'FLOW.contract.d.ts': 'export type Input = string',
        },
      }),
      ...overrides,
    })(directory, { membership: 'exact', projectPath: 'flow' }, captured)
  } finally {
    await captured.dispose()
    await directory.close()
    await project.dispose()
  }
}

test('source-only review is inert; authorized generation publishes and becomes fresh', async () => {
  const root = await fixture()
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_STALE' })
  expect(await prepare(root)).toBe(true)
  expect(await readFile(join(root, 'flow/FLOW.contract.json'), 'utf8')).toBe(descriptor)
  expect(await prepare(root, false)).toBe(false)
  await writeFile(join(root, 'flow/FLOW.contract.tsp'), 'edited')
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_STALE' })
  expect(await prepare(root)).toBe(true)
})

test('compiler cancellation settles its process without publishing', async () => {
  const root = await fixture()
  const worker = join(root, 'pending.mjs')
  const marker = join(root, 'started')
  await writeFile(
    worker,
    `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`,
  )
  const stop = new AbortController()
  const pending = generateContract('source', stop.signal, worker)
  const settled = pending.then(
    () => null,
    (error: unknown) => error,
  )
  for (let i = 0; i < 200; i++) {
    if (await Bun.file(marker).exists()) break
    await Bun.sleep(10)
  }
  stop.abort()
  expect(await settled).toBeDefined()
  const pid = Number(await readFile(marker, 'utf8'))
  expect(() => process.kill(pid, 0)).toThrow()
})

test('an empty compiler response is an actionable closed failure', async () => {
  const root = await fixture()
  const worker = join(root, 'empty.mjs')
  await writeFile(worker, 'process.exit(0)')
  await expect(
    generateContract('source', new AbortController().signal, worker),
  ).rejects.toMatchObject({ code: 'AUTHORING_COMPILER' })
})
test('compiler failure publishes nothing and preserves the preceding batch', async () => {
  const root = await fixture()
  await prepare(root)
  await writeFile(join(root, 'flow/FLOW.contract.tsp'), 'broken')
  await expect(
    prepare(root, true, {
      compile: async () => {
        throw new Error('mapping failed')
      },
    }),
  ).rejects.toThrow('mapping failed')
  expect(await readFile(join(root, 'flow/FLOW.contract.json'), 'utf8')).toBe(descriptor)
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_STALE' })
})
test('edited and unowned destinations conflict, including symlinks', async () => {
  const root = await fixture()
  await writeFile(join(root, 'flow/FLOW.contract.json'), 'user content')
  await expect(prepare(root)).rejects.toMatchObject({ code: 'AUTHORING_CONFLICT' })
  await unlink(join(root, 'flow/FLOW.contract.json'))
  await prepare(root)
  await writeFile(join(root, 'flow/answer.schema.json'), 'edited')
  await expect(prepare(root)).rejects.toMatchObject({ code: 'AUTHORING_CONFLICT' })
  await unlink(join(root, 'flow/answer.schema.json'))
  await symlink('/etc/passwd', join(root, 'flow/answer.schema.json'))
  await expect(prepare(root)).rejects.toBeDefined()
})
test('removed projections and types are removed only when still owned', async () => {
  const root = await fixture()
  await prepare(root)
  await writeFile(join(root, 'flow/FLOW.contract.tsp'), 'no types')
  await prepare(root, true, {
    compile: async (source) => ({ source, artifacts: { 'FLOW.contract.json': descriptor } }),
  })
  await expect(readFile(join(root, 'flow/FLOW.contract.d.ts'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  await expect(readFile(join(root, 'flow/answer.schema.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(await prepare(root, false)).toBe(false)
})
test('interrupted publication blocks plain review; recovery completes only its recorded batch', async () => {
  const root = await fixture()
  await expect(
    prepare(root, true, {
      afterPublish: async () => {
        throw new Error('crash')
      },
    }),
  ).rejects.toThrow('crash')
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_INTERRUPTED' })
  await prepare(root, true, {
    compile: async () => {
      throw new Error('must not compile during recovery')
    },
  })
  expect(await prepare(root, false)).toBe(false)
})
test('recovery refuses a third value without overwriting it', async () => {
  const root = await fixture()
  await expect(
    prepare(root, true, {
      afterPublish: async () => {
        throw new Error('crash')
      },
    }),
  ).rejects.toThrow()
  await writeFile(join(root, 'flow/FLOW.contract.json'), 'manual after interruption')
  await expect(prepare(root)).rejects.toMatchObject({ code: 'AUTHORING_CONFLICT' })
  expect(await readFile(join(root, 'flow/FLOW.contract.json'), 'utf8')).toBe(
    'manual after interruption',
  )
})
test('source edits during compilation prevent publication', async () => {
  const root = await fixture()
  await expect(
    prepare(root, true, {
      compile: async (source) => {
        await writeFile(join(root, 'flow/FLOW.contract.tsp'), 'racing')
        return { source, artifacts: { 'FLOW.contract.json': descriptor } }
      },
    }),
  ).rejects.toMatchObject({ code: 'AUTHORING_CONFLICT' })
  await expect(readFile(join(root, 'flow/FLOW.contract.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
})
test('cancellation before publication and during publication cannot declare freshness', async () => {
  const root = await fixture(),
    stop = new AbortController()
  await expect(
    prepare(root, true, {
      signal: stop.signal,
      compile: async (source) => {
        stop.abort()
        return { source, artifacts: { 'FLOW.contract.json': descriptor } }
      },
    }),
  ).rejects.toBeDefined()
  await expect(readFile(join(root, 'flow/FLOW.contract.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  const during = new AbortController()
  await expect(
    prepare(root, true, {
      signal: during.signal,
      afterPublish: async () => {
        during.abort()
      },
    }),
  ).rejects.toBeDefined()
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_INTERRUPTED' })
})
test('removing the source explicitly releases unchanged JSON and preserves recovery source', async () => {
  const root = await fixture()
  await prepare(root)
  await unlink(join(root, 'flow/FLOW.contract.tsp'))
  await expect(prepare(root, false)).rejects.toMatchObject({ code: 'AUTHORING_STALE' })
  await prepare(root)
  await writeFile(join(root, 'flow/FLOW.contract.json'), descriptor + ' ')
  expect(await prepare(root, false)).toBe(false)
})
test('complete imported packages can be reviewed without compiling or claiming freshness', async () => {
  const root = await fixture()
  await writeFile(join(root, 'flow/FLOW.contract.json'), descriptor)
  expect(
    await prepare(root, false, {
      compile: async () => {
        throw new Error('no compiler')
      },
    }),
  ).toBe(false)
})

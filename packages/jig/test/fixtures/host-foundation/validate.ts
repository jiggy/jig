import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeFoundationApplication } from './materialize.js'

// Registration-free construction/bundling only. Never execute a consumer Flow.
const root = await mkdtemp(join(tmpdir(), 'jig-foundation-source-validation-'))
let passed = false
try {
  let count = 0
  for (const application of ['adaptive', 'documents'] as const) {
    const { entrypoints, project } = await materializeFoundationApplication(
      join(root, application),
      application,
      'http://127.0.0.1:43210',
    )
    for (const path of entrypoints) {
      const source = await readFile(path, 'utf8')
      assert.doesNotMatch(source, /(?:src\/internal|\.delta|examples\/|test\/fixtures|Bun\.spawn)/)
      const result = await Bun.build({
        entrypoints: [path],
        target: 'bun',
        external: ['@jigging/flow', '@jigging/jig', '@jigging/jig/client'],
      })
      assert.equal(result.success, true, result.logs.join('\n'))
      count++
    }
    if (application === 'adaptive') {
      const recipe = JSON.parse(await readFile(join(project, 'evaluation/evaluation.json'), 'utf8'))
      assert.deepEqual(recipe, {
        family: 'bun-typescript',
        generate: 'tools/generate.js',
        test: ['test/answer.test.js'],
        collect: ['generated', 'dist', 'reports'],
      })
      const manifest = JSON.parse(await readFile(join(project, 'evaluation/package.json'), 'utf8'))
      assert.equal(manifest.dependencies.zod, '3.23.8')
      assert.equal(manifest.devDependencies.typescript, '5.7.3')
    } else {
      const grant = JSON.parse(await readFile(join(project, 'grants/barrier.json'), 'utf8'))
      assert.equal(grant.kind, 'http')
      assert.equal(grant.url, 'http://127.0.0.1:43210/hold')
      assert.equal(grant.timeoutMs, 60_000)
      assert.deepEqual(grant.bodySchema.properties.episode.enum, ['cancel', 'death'])
      const binding = await readFile(join(project, 'bindings/root.ts'), 'utf8')
      assert.match(binding, /"barrier":"grant:barrier"/)
      const metadata = JSON.parse(await readFile(join(project, 'flows/root/FLOW.meta.json'), 'utf8'))
      assert.equal(metadata.uses.barrier.contract, './contracts/http/contract.json')
    }
  }
  const harness = await Bun.build({
    entrypoints: [join(import.meta.dir, '../../host/installed-host-foundation.test.ts')],
    target: 'bun',
    packages: 'external',
  })
  assert.equal(harness.success, true, harness.logs.join('\n'))
  await writeFile(
    join(root, 'validation.json'),
    JSON.stringify({
      sources: count,
      harnessBundle: true,
      native: 'not-executed',
      evidence: 'maintainer source construction and bundling only',
    }),
  )
  console.log(
    `Constructed two independent applications; bundled ${count} complete consumer entrypoints and host suite. No native/installed execution.`,
  )
  passed = true
} finally {
  if (passed) await rm(root, { recursive: true, force: true })
  else console.error(`Foundation source validation evidence retained at ${root}`)
}

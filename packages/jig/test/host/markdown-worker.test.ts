import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { block, createMarkdownFixtures, done, packageRoot } from '../markdown-worker.fixture.js'

const markdownFixtures = createMarkdownFixtures()
const {
  command,
  exchange,
  fixture,
  prepareCandidateSdkWorkspace,
  selectArchive,
  writeTypeScriptEcho,
} = markdownFixtures

beforeAll(async () => {
  markdownFixtures.temporary = await mkdtemp(join(tmpdir(), 'jig-markdown-worker-test-'))
  const libexec = join(markdownFixtures.temporary, 'libexec')
  await mkdir(libexec)
  markdownFixtures.worker = join(libexec, 'markdown-runtime.js')
  if (process.platform === 'darwin')
    await copyFile(
      join(packageRoot, 'support/macos-descriptor-bridge.dylib'),
      join(libexec, 'macos-descriptor-bridge.dylib'),
    )
  const build = await Bun.build({
    entrypoints: [join(packageRoot, 'src/internal/markdown-runtime-worker.ts')],
    target: 'bun',
    format: 'esm',
    outdir: libexec,
    naming: 'markdown-runtime.js',
  })
  expect(build.success).toBe(true)
})
afterAll(async () => {
  if (markdownFixtures.temporary === undefined) return
  if (markdownFixtures.preserveFailureEvidence) {
    console.error(`Installed Markdown failure evidence retained at ${markdownFixtures.temporary}`)
  } else {
    await rm(markdownFixtures.temporary, { recursive: true, force: true })
  }
})
describe.serial('fresh installed Markdown admission on the provisioned proof host', () => {
  test('requires an Agent for every Markdown body while code execution remains Agent-free', async () => {
    const root = await mkdtemp(join(markdownFixtures.temporary, 'installed-'))
    const artifacts = join(root, 'artifacts')
    const sdkArtifacts = join(root, 'sdk-artifacts')
    const consumer = join(root, 'consumer')
    await mkdir(artifacts)
    await mkdir(sdkArtifacts)
    await mkdir(consumer)
    const archive = await selectArchive(artifacts)
    await writeFile(
      join(consumer, 'package.json'),
      JSON.stringify({
        private: true,
        dependencies: { '@jigging/jig': `file:${archive}` },
      }),
    )
    await command(
      [
        process.execPath,
        'install',
        '--ignore-scripts',
        '--no-progress',
        '--backend',
        'copyfile',
        '--network-concurrency',
        '1',
      ],
      consumer,
    )
    const jig = join(consumer, 'node_modules/.bin/jig')
    const project = join(consumer, 'project')
    await command([jig, 'init', '--bare', project], consumer)
    const resultSchema = {
      type: 'object',
      properties: { outcome: { const: 'done' }, output: {} },
      required: ['outcome', 'output'],
      additionalProperties: false,
    }
    const descriptor = JSON.stringify({
      $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
      id: 'https://example.org/markdown-echo',
      version: '1.0.0',
      input: resultSchema,
      result: resultSchema,
    })
    for (const name of ['recipes', 'prose']) await mkdir(join(project, 'flows', name))
    await writeFile(join(project, 'flows/recipes/FLOW.md'), block('return @input'))
    await writeFile(
      join(project, 'flows/prose/FLOW.md'),
      'Return the input unchanged.\n' + block('return @input'),
    )
    await writeTypeScriptEcho(join(project, 'flows/code-echo'), descriptor)
    await prepareCandidateSdkWorkspace(
      project,
      await selectArchive(sdkArtifacts, undefined, 'flow-sdk'),
    )
    for (const name of ['recipes', 'prose', 'code-echo']) {
      const markdown = name !== 'code-echo'
      if (markdown)
        await writeFile(
          join(project, 'bindings/selected.ts'),
          `import {defineBinding} from "@jigging/jig"; export default defineBinding({package:"flows/${name}"});`,
        )
      await writeFile(
        join(project, 'jig.ts'),
        `import { defineJig } from "@jigging/jig"; export default defineJig({ flows: ["flows/${name}"], bindings: ${markdown ? '["bindings/selected.ts"]' : '[]'} });\n`,
      )
      await command(
        [jig, 'review', '--yes'],
        project,
        markdown ? 1 : 0,
        `review ${name}`,
        markdown ? 'PROJECT_BINDING_INTERFACE_UNRESOLVED' : undefined,
      )
    }
    const output = { exact: ['😺', null], text: 'x'.repeat(102_400) }
    const result = JSON.parse(
      await command(
        [jig, 'run', 'flow:flows/code-echo', '--input', JSON.stringify(done(output))],
        project,
        0,
        'Agent-free code Flow',
      ),
    )
    expect(result).toMatchObject({ status: 'succeeded', outcome: 'done', output })
  }, 120_000)
})

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
)
  throw Error('This suite requires opted-in native host qualification')

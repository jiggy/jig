import { afterAll, beforeAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { buildExamples } from './build-examples'

const archive = process.env.FLOW_SDK_PACKAGE_ARCHIVE ?? ''
const withArchive = archive ? test : test.skip
let temporary: string
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'jig-example-tests.'))
})
afterAll(async () => {
  await rm(temporary, { recursive: true, force: true })
})
const hash = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

async function sourceCopy(name: string) {
  const source = join(temporary, name)
  await mkdir(source)
  await cp(resolve(import.meta.dir, '../LICENSE'), join(source, 'LICENSE'))
  for (const application of ['tested-patch', 'live-agent', 'dataset-analysis']) {
    await cp(
      resolve(import.meta.dir, '../examples', application),
      join(source, 'examples', application),
      {
        recursive: true,
        filter: (path) =>
          !path
            .split('/')
            .some((part) => ['node_modules', '.jig', '.tmp', '__pycache__'].includes(part)),
      },
    )
  }
  return source
}

test('refuses an existing output without changing it', async () => {
  const output = join(temporary, 'collision')
  await mkdir(output)
  await writeFile(join(output, 'keep'), 'untouched')
  await expect(buildExamples('/missing-sdk', output)).rejects.toThrow('Output already exists')
  expect(await readFile(join(output, 'keep'), 'utf8')).toBe('untouched')
})

test('refuses missing, non-archive and symlink SDK inputs without publication', async () => {
  const bad = join(temporary, 'bad.tgz'),
    link = join(temporary, 'linked.tgz')
  await writeFile(bad, 'not an archive')
  await symlink(bad, link)
  for (const [index, sdk] of [join(temporary, 'missing'), bad, link].entries()) {
    const output = join(temporary, `bad-output-${index}`)
    await expect(buildExamples(sdk, output)).rejects.toThrow()
    expect(await lstat(output).catch(() => undefined)).toBeUndefined()
  }
  expect((await readdir(temporary)).some((name) => name.startsWith('.jig-examples.'))).toBe(false)
})

withArchive(
  'builds exact, self-contained readable examples without local state or shadow sources',
  async () => {
    const source = await sourceCopy('source')
    const app = join(source, 'examples/live-agent')
    await writeFile(join(app, 'flows/chat/.env'), 'secret sentinel')
    await writeFile(join(app, 'flows/chat/credentials.json'), '{"secret":"sentinel"}')
    await mkdir(join(app, 'flows/chat/results'), { recursive: true })
    await writeFile(join(app, 'flows/chat/results/previous.json'), '{"private":"old result"}')
    await mkdir(join(app, 'flows/chat/node_modules'), { recursive: true })
    await writeFile(join(app, 'flows/chat/node_modules/ambient.ts'), 'throw new Error("ambient")')
    await mkdir(join(app, 'flows/obsolete'), { recursive: true })
    await writeFile(join(app, 'flows/obsolete/bun.lock'), 'inert old generated state')
    const original = await readFile(join(app, 'flows/chat/flow.ts'))
    const output = join(temporary, 'built')
    const manifest = JSON.parse(
      await readFile(await buildExamples(archive, output, source), 'utf8'),
    )
    expect(manifest.sdk.name).toBe('@jigging/flow')
    expect(manifest.examples.map((application: { name: string }) => application.name)).toEqual([
      'tested-patch',
      'live-agent',
      'dataset-analysis',
    ])
    expect(manifest.sdk.digest).toBe(hash(await readFile(archive)))
    expect(await readFile(join(app, 'flows/chat/flow.ts'))).toEqual(original)
    const extracted = join(temporary, 'extracted')
    await mkdir(extracted)
    for (const application of manifest.examples) {
      const artifact = join(output, application.archive)
      expect(hash(await readFile(artifact))).toBe(application.digest)
      const child = Bun.spawn(['tar', '-xzf', artifact, '-C', extracted], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      expect(await child.exited).toBe(0)
      const paths = application.files.map((file: { path: string }) => file.path)
      expect(
        paths.some((path: string) =>
          /node_modules|credentials|\.env|obsolete|flow\.source|results\/|AGENTS.md/.test(path),
        ),
      ).toBe(false)
      expect(paths).toContain('LICENSE')
      for (const file of application.files) {
        const bytes = await readFile(join(extracted, application.name, file.path))
        expect(bytes.length).toBe(file.bytes)
        expect(hash(bytes)).toBe(file.digest)
      }
      for (const flow of application.flows) {
        expect(paths).toContain(`${flow}/FLOW-SDK-LICENSE`)
        expect(paths).toContain(`${flow}/LICENSE`)
        expect(
          paths.filter((path: string) => path.startsWith(`${flow}/`) && /\.(?:ts|js)$/.test(path)),
        ).toEqual([`${flow}/flow.ts`])
        expect(paths).not.toContain(`${flow}/package.json`)
        expect(paths).not.toContain(`${flow}/bun.lock`)
        const program = await readFile(join(extracted, application.name, flow, 'flow.ts'), 'utf8')
        expect(program).not.toContain(source)
        expect(program).not.toContain('jig-example-build.')
      }
      if (application.name === 'tested-patch')
        expect(paths).toContain('fixtures/log-report/package.json')
    }
    // The authoring workspace is already gone; remove this disposable source too.
    await rm(source, { recursive: true, force: true })
    for (const application of manifest.examples)
      for (const flow of application.flows) {
        const child = Bun.spawn(
          [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', 'flow.ts'],
          {
            cwd: join(extracted, application.name, flow),
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        )
        const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
        try {
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 'root:1',
              method: 'flow/run',
              params: {
                protocol: 'run/1',
                input: null,
                settings: {},
                attachments: {},
                channels: {},
                scratch: '/unused',
                deadlineUnixMs: Date.now() + 3000,
              },
            })}\n`,
          )
          child.stdin.flush()
          const text = await new Response(child.stdout).text()
          const diagnostics = await new Response(child.stderr).text()
          expect(await child.exited).toBe(0)
          const result = JSON.parse(text)
          expect(result.id).toBe('root:1')
          expect(result.error.data.code).toBe('EXECUTION_FAILED')
          expect(diagnostics).not.toContain('Cannot find')
        } finally {
          clearTimeout(timeout)
          child.kill()
          await child.exited
        }
      }
  },
  30_000,
)

withArchive(
  'refuses an SDK that does not match the application source declaration',
  async () => {
    const source = await sourceCopy('mismatched-sdk')
    const manifest = join(source, 'examples/tested-patch/package.json')
    const value = JSON.parse(await readFile(manifest, 'utf8'))
    value.devDependencies['@jigging/flow'] = '0.0.0-mismatch'
    await writeFile(manifest, JSON.stringify(value))
    const output = join(temporary, 'mismatch-output')
    await expect(buildExamples(archive, output, source)).rejects.toThrow('does not match')
    expect(await lstat(output).catch(() => undefined)).toBeUndefined()
  },
  30_000,
)

withArchive(
  'refuses source symlinks and does not leave a partial output',
  async () => {
    const source = await sourceCopy('linked-source')
    const link = join(source, 'examples/live-agent/flows/chat/extra.ts')
    await symlink(join(dirname(link), 'flow.ts'), link)
    const output = join(temporary, 'linked-output')
    await expect(buildExamples(archive, output, source)).rejects.toThrow('symlinks')
    expect(await lstat(output).catch(() => undefined)).toBeUndefined()
    expect((await readdir(temporary)).some((name) => name.startsWith('.jig-examples.'))).toBe(false)
  },
  30_000,
)

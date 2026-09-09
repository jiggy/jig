import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'

const applications = ['tested-patch', 'live-agent', 'dataset-analysis'] as const
const rootFiles = ['jig.ts', 'README.md', 'issue.json', 'input.json', 'batch.json']
const generatedDirectories = new Set([
  'results',
  'output',
  'outputs',
  'artifacts',
  'logs',
  'sessions',
  'state',
  'dist',
  'build',
])
const excluded =
  /^(?:\.|node_modules$|__pycache__$)|(?:^|[-_.])(?:secrets?|credentials?|tokens?|auth)(?:[-_.]|$)/i
const sourceSuffix = /\.(?:ts|js|json|md|txt)$/
const digest = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
type FileIdentity = { path: string; bytes: number; digest: string }

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function regularBytes(path: string, limit = 1_048_576): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit)
      throw new Error(`Expected a bounded regular file: ${path}`)
    const bytes = await file.readFile()
    if (bytes.length > limit) throw new Error(`File grew beyond its limit: ${path}`)
    return bytes
  } finally {
    await file.close()
  }
}

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of stream) {
      size += chunk.length
      if (size > 1_048_576) {
        child.kill('SIGKILL')
        throw new Error('Build-tool output exceeded 1 MiB')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  try {
    const [stdout, stderr, status] = await Promise.all([
      collect(child.stdout),
      collect(child.stderr),
      child.exited,
    ])
    if (status !== 0)
      throw new Error(
        `${basename(args[0] ?? 'build tool')} failed (${status}): ${stderr.slice(0, 4096)}`,
      )
    return stdout
  } finally {
    clearTimeout(timer)
    child.kill()
    await child.exited
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  if (!(await lstat(directory)).isDirectory())
    throw new Error(`Expected source directory: ${directory}`)
  const files: string[] = []
  async function visit(path: string) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (
        excluded.test(item.name) ||
        item.name === 'bun.lock' ||
        item.name === 'package.json' ||
        item.name === 'AGENTS.md' ||
        item.name === 'result.json' ||
        generatedDirectories.has(item.name)
      )
        continue
      const full = join(path, item.name)
      if (item.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${full}`)
      if (item.isDirectory()) await visit(full)
      else if (item.isFile() && sourceSuffix.test(item.name)) {
        if (files.length >= 512) throw new Error('Application source inventory exceeds 512 files')
        files.push(full)
      } else if (!item.isFile()) throw new Error(`Unsupported source file: ${full}`)
    }
  }
  await visit(directory)
  return files.sort()
}

/** Build the maintained distribution applications; not a runtime preparation API. */
export async function buildExamples(
  sdkArgument: string,
  outputArgument: string,
  sourceRoot = resolve(import.meta.dir, '..'),
) {
  if (Bun.version !== '1.3.3' || Bun.revision !== '274e01c737e85f8142070a9745b43a2ba09fce4c')
    throw new Error('Prepared examples require the repository-pinned Bun 1.3.3 revision')
  const output = resolve(outputArgument)
  if (await exists(output)) throw new Error(`Output already exists: ${output}`)
  const outputParent = dirname(output)
  if (!(await lstat(outputParent)).isDirectory())
    throw new Error('Output parent must be an existing directory')
  const sdkBytes = await regularBytes(resolve(sdkArgument), 16_777_216)
  const applicationLicense = await regularBytes(join(sourceRoot, 'LICENSE'))
  const work = await mkdtemp(join(tmpdir(), 'jig-example-build.'))
  let staging = ''
  try {
    staging = await mkdtemp(join(outputParent, '.jig-examples.'))
    const archive = join(work, 'sdk.tgz')
    await writeFile(archive, sdkBytes, { flag: 'wx' })
    const entries = (await command(['tar', '-tzf', archive], work)).trim().split('\n')
    if (
      entries.length > 1024 ||
      new Set(entries).size !== entries.length ||
      entries.some(
        (entry) => !/^package\/[A-Za-z0-9_./-]+\/?$/.test(entry) || entry.split('/').includes('..'),
      )
    )
      throw new Error('SDK archive has an invalid inventory')
    const details = (await command(['tar', '-tvzf', archive], work)).trim().split('\n')
    if (details.some((entry) => !entry.startsWith('-') && !entry.startsWith('d')))
      throw new Error('SDK archive links and special files are not supported')
    const sdk = JSON.parse(await command(['tar', '-xOzf', archive, 'package/package.json'], work))
    if (
      sdk.name !== '@jigging/flow' ||
      typeof sdk.version !== 'string' ||
      sdk.exports?.['.']?.import !== './dist/index.js' ||
      ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies'].some(
        (key) => sdk[key] !== undefined && Object.keys(sdk[key]).length !== 0,
      )
    )
      throw new Error('Supply a dependency-free, freshly packed @jigging/flow SDK')
    await writeFile(
      join(work, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'file:./sdk.tgz' },
      }),
      { flag: 'wx' },
    )
    await command(
      [
        process.execPath,
        '--no-env-file',
        'install',
        '--ignore-scripts',
        '--config=/dev/null',
        '--backend=copyfile',
        '--no-progress',
        '--no-summary',
      ],
      work,
    )
    const records = []
    for (const application of applications) {
      const source = join(sourceRoot, 'examples', application)
      if ((await lstat(source)).isSymbolicLink())
        throw new Error('Application source must not be a symlink')
      const manifestBytes = await regularBytes(join(source, 'package.json'))
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      if (manifest.devDependencies?.['@jigging/flow'] !== sdk.version)
        throw new Error(`The supplied SDK does not match ${application}'s declared version`)
      const author = join(work, application)
      const prepared = join(work, 'prepared', application)
      await mkdir(author, { recursive: true })
      await mkdir(prepared, { recursive: true })
      const inventory: string[] = []
      for (const name of rootFiles)
        if (await exists(join(source, name))) inventory.push(join(source, name))
      for (const name of ['bindings', 'fixtures']) {
        const directory = join(source, name)
        if (await exists(directory)) inventory.push(...(await sourceFiles(directory)))
      }
      // Repository package.json files are inert test inputs, not Flow dependencies.
      const fixtures = join(source, 'fixtures')
      if (await exists(fixtures))
        for (const entry of await readdir(fixtures, { withFileTypes: true })) {
          if (
            entry.isDirectory() &&
            !excluded.test(entry.name) &&
            (await exists(join(fixtures, entry.name, 'package.json')))
          )
            inventory.push(join(fixtures, entry.name, 'package.json'))
        }
      const flows: string[] = []
      const flowRoot = join(source, 'flows')
      if ((await lstat(flowRoot)).isSymbolicLink())
        throw new Error('Flow source must not be a symlink')
      for (const entry of await readdir(flowRoot, { withFileTypes: true })) {
        if (excluded.test(entry.name)) continue
        if (entry.isSymbolicLink()) throw new Error('Flow directories must not be symlinks')
        if (!entry.isDirectory() || !(await exists(join(flowRoot, entry.name, 'FLOW.md')))) continue
        const path = join('flows', entry.name)
        if (!(await exists(join(source, path, 'flow.ts'))))
          throw new Error(`Flow has no TypeScript entrypoint: ${path}`)
        flows.push(path)
        inventory.push(...(await sourceFiles(join(source, path))))
      }
      if (flows.length === 0 || flows.length > 16 || inventory.length > 512)
        throw new Error('Application source inventory is missing or oversized')
      const sourceIdentity: FileIdentity[] = [
        {
          path: 'package.json',
          bytes: manifestBytes.length,
          digest: digest(manifestBytes),
        },
      ]
      let bytes = 0
      for (const file of inventory.sort()) {
        const path = relative(source, file)
        const data = await regularBytes(file)
        bytes += data.length
        if (bytes > 8_388_608) throw new Error('Application source exceeds 8 MiB')
        sourceIdentity.push({ path, bytes: data.length, digest: digest(data) })
        for (const base of [author, prepared]) {
          await mkdir(dirname(join(base, path)), { recursive: true })
          await writeFile(join(base, path), data, { flag: 'wx' })
        }
      }
      for (const path of flows.sort()) {
        const entrypoint = join(prepared, path, 'flow.ts')
        await command(
          [
            process.execPath,
            '--no-env-file',
            'build',
            './flow.ts',
            '--target=bun',
            '--format=esm',
            '--outfile',
            entrypoint,
          ],
          join(author, path),
        )
        // The readable bundle is the one effective program. Do not leave inert
        // module copies which appear editable but no longer affect execution.
        for (const file of inventory) {
          const local = relative(source, file)
          if (
            local.startsWith(`${path}/`) &&
            local !== `${path}/flow.ts` &&
            /\.(?:ts|js)$/.test(local)
          )
            await rm(join(prepared, local))
        }
        await writeFile(
          join(prepared, path, 'FLOW-SDK-LICENSE'),
          await regularBytes(join(work, 'node_modules/@jigging/flow/LICENSE')),
          { flag: 'wx' },
        )
        await writeFile(join(prepared, path, 'LICENSE'), applicationLicense, { flag: 'wx' })
      }
      await writeFile(join(prepared, 'LICENSE'), applicationLicense, { flag: 'wx' })
      const files: FileIdentity[] = []
      async function identify(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = join(directory, entry.name)
          if (entry.isDirectory()) await identify(file)
          else {
            const data = await regularBytes(file, 16_777_216)
            files.push({ path: relative(prepared, file), bytes: data.length, digest: digest(data) })
          }
        }
      }
      await identify(prepared)
      const filename = `${application}.tar.gz`
      await command(
        [
          'tar',
          '--sort=name',
          '--format=ustar',
          '--mtime=@0',
          '--owner=0',
          '--group=0',
          '--numeric-owner',
          '-czf',
          join(staging, filename),
          '-C',
          dirname(prepared),
          application,
        ],
        work,
      )
      records.push({
        name: application,
        archive: filename,
        digest: digest(await regularBytes(join(staging, filename), 16_777_216)),
        flows,
        sourceFiles: sourceIdentity,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
      })
    }
    await writeFile(
      join(staging, 'examples.json'),
      `${JSON.stringify(
        {
          kind: 'jig-prepared-examples/1',
          sdk: {
            name: sdk.name,
            version: sdk.version,
            archive: basename(sdkArgument),
            digest: digest(sdkBytes),
          },
          bun: { version: Bun.version, revision: Bun.revision },
          examples: records,
        },
        null,
        2,
      )}\n`,
      { flag: 'wx' },
    )
    await command(['mv', '-T', '--no-clobber', staging, output], outputParent)
    if (await exists(staging)) throw new Error(`Output appeared during build: ${output}`)
    return join(output, 'examples.json')
  } finally {
    await rm(work, { recursive: true, force: true })
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const [sdk, output] = Bun.argv.slice(2)
  if (Bun.argv.length !== 4 || sdk === undefined || output === undefined) {
    console.error('usage: scripts/build-examples.ts <sdk-archive> <new-output-directory>')
    process.exitCode = 2
  } else
    try {
      console.log(await buildExamples(sdk, output))
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
}

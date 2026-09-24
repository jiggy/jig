import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preparePrivateMacosGuardian } from '../src/internal/macos-guardian-client.js'
import {
  createPrivateMacosVolume,
  recoverPrivateMacosVolume,
} from '../src/internal/macos-volume.js'

const native = test.skipIf(
  process.platform !== 'darwin' || process.env.JIG_MACOS_PROCESS_TEST !== '1',
)

native(
  'native bounded preparation installs ordinary dependencies and executes their retained bytes',
  async () => {
    const root = await mkdtemp('/private/tmp/jig-native-preparation-')
    const control = join(root, 'control'),
      mount = join(root, 'scratch'),
      token = randomBytes(32).toString('hex')
    await mkdir(control, { mode: 0o700 })
    await mkdir(mount, { mode: 0o700 })
    const runtime = join(root, 'runtime')
    await mkdir(runtime, { mode: 0o700 })
    const launcher = join(root, 'launcher'),
      worker = join(runtime, 'preparer.js'),
      projected = join(root, 'prepared')
    let volume: Awaited<ReturnType<typeof createPrivateMacosVolume>> | undefined
    const owners: Awaited<ReturnType<typeof preparePrivateMacosGuardian>>[] = []
    try {
      const compiled = spawnSync(
        '/usr/bin/clang',
        [
          '-O2',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-Wno-deprecated-declarations',
          fileURLToPath(new URL('../support/macos-exec.c', import.meta.url)),
          '-o',
          launcher,
        ],
        { encoding: 'utf8', timeout: 15_000 },
      )
      expect({ status: compiled.status, errors: compiled.stderr }).toEqual({
        status: 0,
        errors: '',
      })
      const build = await Bun.build({
        entrypoints: [
          fileURLToPath(
            new URL('../src/internal/bun-native-preparation-worker.ts', import.meta.url),
          ),
        ],
        target: 'bun',
      })
      expect(build.success).toBe(true)
      await writeFile(worker, await build.outputs[0]!.text(), { flag: 'wx', mode: 0o400 })
      volume = await createPrivateMacosVolume(control, token, mount, 32 * 1024 * 1024)
      await writeFile(join(control, 'canary'), 'private host bytes', { flag: 'wx', mode: 0o600 })
      const source = {
        'package.json': JSON.stringify({
          name: 'native-consumer',
          type: 'module',
          dependencies: { 'is-number': '7.0.0' },
          devDependencies: { semver: '7.7.2' },
          scripts: { postinstall: 'touch script-ran' },
        }),
        'FLOW.ts': `import isNumber from 'is-number';
import { readFileSync, writeFileSync } from 'node:fs';
let outsideDenied = false, sourceDenied = false;
try { readFileSync(${JSON.stringify(join(control, 'canary'))}); } catch { outsideDenied = true; }
try { writeFileSync(import.meta.filename, 'changed'); } catch { sourceDenied = true; }
console.log(JSON.stringify({ value: isNumber(42), platform: process.platform, outsideDenied, sourceDenied }));
`,
      }
      async function run(
        name: string,
        command: [string, ...string[]],
        input: string,
        network: 'isolated' | 'inherited',
      ) {
        const ownerDirectory = join(root, name)
        await mkdir(ownerDirectory, { mode: 0o700 })
        const guardian = await preparePrivateMacosGuardian({
          bun: process.execPath,
          supervisor: fileURLToPath(
            new URL('../src/internal/macos-native-supervisor.ts', import.meta.url),
          ),
          configuration: {
            type: 'start',
            ownerDirectory,
            ownerToken: randomBytes(32).toString('hex'),
            launcher,
            cwd: mount,
            command,
            environment: {},
            files: {
              readOnlyFiles: [process.execPath, worker],
              readOnlyTrees: name === 'flow-owner' ? [runtime, projected] : [runtime],
              writableTrees: [mount],
              protectedRoots: [control, ownerDirectory],
              network,
            },
            limits: {
              memoryBytes: 256 * 1024 * 1024,
              pids: 16,
              cpuQuotaMicros: 100_000,
              cpuPeriodMicros: 100_000,
              deadlineUnixMs: Date.now() + 30_000,
              cleanupTimeoutMs: 5000,
            },
            maxOutputBytes: 1024 * 1024,
          },
        })
        owners.push(guardian)
        let stdout = '',
          stderr = ''
        guardian.stdout.on('data', (bytes) => {
          stdout += bytes.toString()
        })
        guardian.stderr.on('data', (bytes) => {
          stderr += bytes.toString()
        })
        guardian.stdout.resume()
        guardian.stderr.resume()
        await guardian.admit()
        guardian.continue()
        guardian.stdin.end(input)
        const completion = await guardian.completion
        expect(completion.fenced).toBe(true)
        expect({
          result: completion.result?.reason,
          code: completion.result?.exitCode,
          stderr,
          ...(completion.result?.exitCode === 0 ? {} : { stdout }),
        }).toEqual({ result: 'payload_exit', code: 0, stderr: '' })
        return JSON.parse(stdout)
      }
      const policy = ['--no-env-file', '--no-install', '--config=/dev/null']
      const prepared = await run(
        'preparation-owner',
        [process.execPath, ...policy, worker, '--allow-resolution-network'],
        `${JSON.stringify({
          type: 'source',
          files: Object.entries(source)
            .sort(([a], [b]) => Buffer.from(a).compare(Buffer.from(b)))
            .map(([path, content]) => ({ path, content: Buffer.from(content).toString('base64') })),
        })}\n`,
        'inherited',
      )
      expect(prepared.type).toBe('prepared')
      const files = prepared.files as { path: string; content: string }[]
      expect(files.some(({ path }) => path === 'node_modules/is-number/index.js')).toBe(true)
      expect(
        files.some(
          ({ path }) => path.startsWith('node_modules/semver/') || path.endsWith('script-ran'),
        ),
      ).toBe(false)
      expect(
        Buffer.from(files.find(({ path }) => path === 'FLOW.ts')!.content, 'base64').toString(),
      ).toBe(source['FLOW.ts'])
      await mkdir(projected, { mode: 0o700 })
      for (const file of files) {
        await mkdir(dirname(join(projected, file.path)), { recursive: true, mode: 0o700 })
        await writeFile(join(projected, file.path), Buffer.from(file.content, 'base64'), {
          flag: 'wx',
          mode: 0o400,
        })
      }
      await chmod(projected, 0o500)
      expect(
        await run(
          'flow-owner',
          [process.execPath, ...policy, join(projected, 'FLOW.ts')],
          '',
          'isolated',
        ),
      ).toEqual({ value: true, platform: 'darwin', outsideDenied: true, sourceDenied: true })
      expect(await readFile(join(control, 'canary'), 'utf8')).toBe('private host bytes')
    } finally {
      for (const owner of owners) {
        owner.cancel()
        await owner.completion
      }
      await volume?.directory.close()
      await recoverPrivateMacosVolume(control, token)
      // Test-only trusted construction, after both coalitions and the volume settle.
      await chmod(projected, 0o700).catch(() => undefined)
      await rm(root, { recursive: true })
    }
  },
  110_000,
)

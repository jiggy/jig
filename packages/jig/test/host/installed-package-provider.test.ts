import { constants, Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error(
    'This suite requires JIG_LINUX_ROOTLESS_HOSTILE=1 on Linux or JIG_MACOS_PROCESS_TEST=1 on macOS',
  )
}

const testRoot = join(import.meta.dir, '..')

for (const scenario of ['entrypoint', 'dependencies', 'limits'] as const) {
  test(`packed project ${scenario} uses fresh reviewed data and immutable execution`, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), `jig-${scenario}-consumer-`)))
    const packageRoot = join(testRoot, '..')
    const project = join(directory, 'project')
    const tooling = join(directory, 'tooling')
    const artifacts = join(directory, 'artifacts')
    let passed = false
    const put = async (path: string, value: unknown) => {
      await mkdir(dirname(join(project, path)), { recursive: true })
      await writeFile(
        join(project, path),
        typeof value === 'string' ? value : JSON.stringify(value),
      )
    }
    try {
      await mkdir(tooling)
      await mkdir(artifacts)
      let archive = process.env.JIG_PACKAGE_ARCHIVE
      if (!archive) {
        execFileSync(process.execPath, ['scripts/pack.ts', '--destination', artifacts], {
          cwd: packageRoot,
          stdio: 'pipe',
          timeout: 120000,
        })
        const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
        archive = join(artifacts, `jigging-jig-${manifest.version}.tgz`)
      }
      await writeFile(
        join(tooling, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: { '@jigging/jig': `file:${archive}` },
        }),
      )
      execFileSync(
        process.execPath,
        ['install', '--ignore-scripts', '--no-progress', '--backend', 'copyfile'],
        {
          cwd: tooling,
          stdio: 'pipe',
          timeout: 120000,
        },
      )
      const installed = join(tooling, 'node_modules/.bin/jig')
      let sequence = 0
      const invoke = async (
        args: string[],
        operatorEnvironment: Readonly<Record<string, string | undefined>> = {},
      ) => {
        const command = ++sequence
        const trace = join(directory, `${command}-profile.jsonl`)
        const child = Bun.spawn([installed, ...args], {
          cwd: project,
          env: {
            ...process.env,
            NO_COLOR: '1',
            ...operatorEnvironment,
            ...(['review', 'run'].includes(args[0]!) ? { JIG_PRIVATE_PROFILE_FILE: trace } : {}),
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const timer = setTimeout(() => child.kill('SIGTERM'), 120000)
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]).finally(() => clearTimeout(timer))
        await writeFile(
          join(directory, `${command}-${args[0]}.json`),
          JSON.stringify({ args, exit, stdout, stderr }, null, 2),
        )
        let failureEvidence = ''
        if (exit !== 0 && args[0] === 'run') {
          const phases = await readFile(trace, 'utf8')
            .then((value) =>
              value
                .trim()
                .split('\n')
                .slice(1)
                .map((line) => {
                  const event = JSON.parse(line) as {
                    kind: string
                    phase?: string
                    outcome?: string
                    timeMs?: number
                  }
                  return [event.kind, event.phase, event.outcome, event.timeMs]
                }),
            )
            .catch(() => 'unavailable')
          let lifecycle: unknown = 'unavailable'
          try {
            const database = Database.open(
              join(project, '.jig/jig.sqlite3'),
              constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_NOFOLLOW,
            )
            try {
              lifecycle = database
                .query(`SELECT
                  plan_digest IS NOT NULL AS planned,
                  backing_digest IS NOT NULL AS backed,
                  sandbox_digest IS NOT NULL AS sealed,
                  prepared_digest IS NOT NULL AS prepared,
                  provisional_digest IS NOT NULL AS provisional,
                  fence_digest IS NOT NULL AS fenced,
                  release_digest IS NOT NULL AS released,
                  admitted_digest IS NOT NULL AS admitted
                  FROM root_execution_lifecycles ORDER BY rowid DESC LIMIT 1`)
                .get()
            } finally {
              database.close()
            }
          } catch {
            // A failed command need not have reached durable root submission.
          }
          failureEvidence = `\nPrivate Run phases: ${JSON.stringify(phases)}\nRoot checkpoints: ${JSON.stringify(lifecycle)}`
        }
        // Inert inspect/parser paths deliberately do not open a profile or host.
        const profile =
          args[0] === 'review'
            ? (await readFile(trace, 'utf8'))
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line))
            : []
        return { exit, stdout, stderr, profile, failureEvidence }
      }
      const succeed = async (
        args: string[],
        operatorEnvironment?: Readonly<Record<string, string | undefined>>,
      ) => {
        const result = await invoke(args, operatorEnvironment)
        expect(result.exit, result.stdout + result.stderr + result.failureEvidence).toBe(0)
        return result
      }
      const declaration = (entrypoint: string) => `import {defineJig,discover} from '@jigging/jig';
export default defineJig({flows:discover('flows'),bindings:discover('bindings'),entrypoint:${JSON.stringify(entrypoint)}});`
      const echo = `import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});
for await (const line of lines) {
 const request=JSON.parse(line);
 const {input,attachments}=request.params;
 let output=input;
 if(attachments.source) {
  const source=await Bun.file(attachments.source.path+'/value.txt').text();
  output={input,source};
  await Bun.write(attachments.result.path+'/copy.txt',source);
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{outcome:'done',output}})+'\\n');
 break;
}`
      if (scenario === 'entrypoint') {
        await put('package.json', { private: true, type: 'module' })
        await put('flows/echo/FLOW.ts', echo)
        await put('flows/files/FLOW.ts', echo)
        await put(
          'flows/crash/FLOW.ts',
          "console.error('fixture: installed Flow deliberately raising SIGSEGV'); process.kill(process.pid, 'SIGSEGV');",
        )
        await put('flows/files/FLOW.contract.json', {
          $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
          input: {
            type: 'object',
            properties: { job: { type: 'string', enum: ['first', 'second'] } },
            required: ['job'],
            additionalProperties: false,
          },
          attachments: { source: 'read', result: 'read-write' },
        })
        await put(
          'bindings/factory.ts',
          `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/files'});`,
        )
        await put(
          'jig.ts',
          declaration(
            `binding:factory --input '@job data.json' --attach 'source=source files' --out result --timeout 30s`,
          ),
        )
        await put('job data.json', { job: 'first' })
        await put('source files/value.txt', 'original')
        const review = await succeed(['review', '--yes'])
        expect(review.stdout).toContain('Project entrypoint')
        const inspection = JSON.parse((await succeed(['inspect', '--json'])).stdout)
        expect(inspection.entrypoint).toContain('binding:factory --input')
        const crashStarted = performance.now()
        const crashed = await invoke(['run', 'flow:flows/crash', '--timeout', '30s', '--json'])
        expect(performance.now() - crashStarted).toBeLessThan(20_000)
        expect(crashed.exit).toBe(1)
        const crashTerminal = JSON.parse(crashed.stdout)
        expect(crashTerminal.status).toBe('failed')
        // Fast natural signal exit can close Run/0 before crash polling observes
        // it. Both are honest failures; neither should consume the Run deadline.
        expect(['EXECUTION_FAILED', 'CHANNEL_LOST']).toContain(crashTerminal.code)
        // A following ordinary Run remains usable after the failed invocation.
        // Unreviewed source must not affect selection or cause reevaluation.
        await put('jig.ts', 'throw new Error("unreviewed source must not execute")')
        const first = JSON.parse((await succeed(['run', '--json'])).stdout)
        expect(first).toMatchObject({
          status: 'succeeded',
          outcome: 'done',
          output: { input: { job: 'first' }, source: 'original' },
        })
        const occupied = await invoke(['run', '--json'])
        expect(occupied.exit).not.toBe(0)
        expect(occupied.stderr).toContain('JIG_OUTPUT_EXISTS')
        await put('job data.json', { job: 'second' })
        await put('source files/value.txt', 'fresh')
        const second = JSON.parse(
          (await succeed(['run', '--out', 'second-result', '--timeout', '45s', '--json'])).stdout,
        )
        expect(second).toMatchObject({
          status: 'succeeded',
          output: { input: { job: 'second' }, source: 'fresh' },
        })
        // Explicit targets bypass all defaults, including the occupied output.
        const direct = JSON.parse(
          (await succeed(['run', 'flow:flows/echo', '--input', '"direct"', '--json'])).stdout,
        )
        expect(direct).toMatchObject({ status: 'succeeded', output: 'direct' })
        const sameTarget = await invoke(['run', 'binding:factory', '--json'])
        expect(sameTarget.exit).not.toBe(0)
        expect(sameTarget.stdout + sameTarget.stderr).not.toContain('JIG_OUTPUT_EXISTS')
        expect(sameTarget.stdout + sameTarget.stderr).toContain('JIG_RUN_FILES_INVALID')
        // An invalid job remains invalid after a fresh review. Guidance names
        // approved input and channel declarations without guessing the cause.
        await put('job data.json', { job: 'third' })
        await put(
          'jig.ts',
          declaration(
            `binding:factory --input '@job data.json' --attach 'source=source files' --out result --timeout 30s`,
          ),
        )
        for (const output of ['rejected-before-review', 'rejected-after-review']) {
          if (output === 'rejected-after-review') await succeed(['review', '--yes'])
          const rejected = await invoke(['run', '--out', output, '--json'])
          expect(rejected.exit).toBe(1)
          expect(rejected.stderr).toContain('The input or channel request was rejected as invalid.')
          expect(rejected.stderr).toContain(
            "approved target's input schema and channel declarations",
          )
          expect(rejected.stderr).toContain('connect required output channels with --receive NAME')
          expect(rejected.stderr).toContain('If you edited the Flow or its contract')
          expect(rejected.stderr).not.toContain(
            'Input does not match the approved target input schema',
          )
          expect(rejected.stderr).not.toContain('Review required')
          const terminal = JSON.parse(rejected.stdout)
          expect(terminal).toMatchObject({
            status: 'failed',
            code: 'INVALID_INPUT',
            details: { keyword: 'enum', instancePointer: '/job' },
          })
          expect(terminal.input.attachments[0].files[0].path).toBe('value.txt')
          const packet = JSON.parse(await readFile(join(project, output, 'result.json'), 'utf8'))
          expect(packet.details).toEqual(terminal.details)
          expect(packet.method).toEqual(terminal.method)
          expect(packet.input).toEqual(terminal.input)
        }
        await put('jig.ts', declaration('flow:flows/echo'))
        await succeed(['review', '--yes'])
        const short = JSON.parse((await succeed(['run', '--input', '"short"', '--json'])).stdout)
        expect(short).toMatchObject({ status: 'succeeded', output: 'short' })
        passed = true
        return
      }

      if (scenario === 'limits') {
        const defaultBytes = 32 * 1024 * 1024
        const expandedBytes = 64 * 1024 * 1024
        const bytesVariable = 'JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_BYTES'
        const baseEnvironment = {
          [bytesVariable]: undefined,
          JIG_LIMITS_DEPENDENCIES_MAX_PREPARED_FILES: undefined,
        }
        const declareLimits = (maximum?: number) =>
          `import {defineJig} from '@jigging/jig'; export default defineJig({flows:['flows/large'],${maximum === undefined ? '' : `limits:{dependencies:{maxPreparedBytes:${maximum}}},`}});`
        await put('package.json', { private: true, type: 'module' })
        await put('jig.ts', declareLimits())
        await put('flows/large/package.json', {
          name: 'large-dependency-consumer',
          private: true,
          type: 'module',
          dependencies: { typescript: '5.2.2' },
        })
        await put(
          'flows/large/FLOW.ts',
          `import {createInterface} from 'node:readline';
import {readdir,stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript/package.json';
async function bytes(directory) {
 let total=0;
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const path=join(directory,entry.name);
  total+=entry.isDirectory()?await bytes(path):(await stat(path)).size;
 }
 return total;
}
const retainedBytes=await bytes(dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))));
for await(const line of createInterface({input:process.stdin})) {
 const request=JSON.parse(line);
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{outcome:'done',output:{typescript:ts.version,retainedBytes}}})+'\\n');
 break;
}`,
        )
        // An ordinary authored lock makes every review exercise the same exact
        // registry closure; no preparation needs resolution-network permission.
        execFileSync(
          process.execPath,
          ['install', '--lockfile-only', '--ignore-scripts', '--no-progress'],
          {
            cwd: join(project, 'flows/large'),
            env: {},
            stdio: 'pipe',
            timeout: 120000,
          },
        )
        await rm(join(project, 'flows/large/node_modules'), { recursive: true, force: true })
        const authoredLock = await readFile(join(project, 'flows/large/bun.lock'))
        const refused = await invoke(['review', '--yes'], baseEnvironment)
        expect(refused.exit).toBe(1)
        expect(refused.stderr).toContain('PACKAGE_BUN_OUTPUT_LIMIT')
        expect(refused.stderr).toContain('maxPreparedBytes')
        expect(refused.stderr).toContain(bytesVariable)
        expect(refused.stderr).toContain(`Effective limit: ${defaultBytes}`)
        expect(refused.stderr).toContain('Limit source: built-in default')
        const observedBytes = (stderr: string) => {
          const match = /Observed: at least ([0-9]+) bytes/.exec(stderr)
          expect(match).not.toBeNull()
          return Number(match![1])
        }
        expect(observedBytes(refused.stderr)).toBeGreaterThan(defaultBytes)

        await put('jig.ts', declareLimits(expandedBytes))
        await succeed(['review', '--yes'], baseEnvironment)
        const run = async () =>
          JSON.parse(
            (
              await succeed(
                ['run', 'flow:flows/large', '--timeout', '120s', '--json'],
                baseEnvironment,
              )
            ).stdout,
          )
        const admitted = await run()
        expect(admitted).toMatchObject({
          status: 'succeeded',
          outcome: 'done',
          output: { typescript: '5.2.2' },
        })
        expect(admitted.output.retainedBytes).toBeGreaterThan(defaultBytes)

        // A lower operator selection takes precedence even when the installed
        // dependency closure can be reused from the previous approval.
        const constrained = await invoke(['review', '--yes'], {
          ...baseEnvironment,
          [bytesVariable]: String(defaultBytes),
        })
        expect(constrained.exit).toBe(1)
        expect(constrained.stderr).toContain('PACKAGE_BUN_OUTPUT_LIMIT')
        expect(constrained.stderr).toContain(`Effective limit: ${defaultBytes}`)
        expect(constrained.stderr).toContain(`Limit source: ${bytesVariable}`)
        expect(observedBytes(constrained.stderr)).toBeGreaterThan(defaultBytes)
        expect(await run()).toMatchObject({
          status: 'succeeded',
          output: admitted.output,
        })

        // An environment override also works without a project override. Runs
        // subsequently use admitted bytes without needing that environment.
        await put('jig.ts', declareLimits())
        await succeed(['review', '--yes'], {
          ...baseEnvironment,
          [bytesVariable]: String(expandedBytes),
        })
        expect(await run()).toMatchObject({ status: 'succeeded', output: admitted.output })
        expect(await readFile(join(project, 'flows/large/bun.lock'))).toEqual(authoredLock)
        passed = true
        return
      }

      // A real installed consumer edits project source without a new install.
      // These are local Bun workspace inputs, not registry/model calls.
      await put('jig.ts', declaration('binding:dependencies'))
      await put('package.json', {
        private: true,
        type: 'module',
        workspaces: ['flows/dependencies', 'libs/*'],
      })
      await put('libs/helper/package.json', {
        name: 'helper',
        type: 'module',
        exports: './index.ts',
      })
      await put('libs/helper/index.ts', 'export const value = 1;')
      await put('libs/helper/removed.txt', 'original resource')
      await put('flows/dependencies/package.json', {
        name: 'dependencies',
        type: 'module',
        dependencies: { helper: 'workspace:*' },
      })
      await put(
        'flows/dependencies/FLOW.ts',
        `import {value} from 'helper';\n${echo.replace('let output=input;', 'let output={input,value,settings:request.params.settings};')}`,
      )
      await put('flows/dependencies/settings.schema.json', {
        $schema: 'https://flow.jig.md/schemas/schema-0.json',
        type: 'object',
        properties: { phase: { type: 'string' } },
        additionalProperties: false,
      })
      const binding = (phase: string) =>
        `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'flows/dependencies',settings:{phase:${JSON.stringify(phase)}}});`
      await put('bindings/dependencies.ts', binding('first'))
      const count = (result: Awaited<ReturnType<typeof invoke>>, phase: string) =>
        result.profile.filter(
          (record) =>
            record.phase === phase && (record.kind === 'start' || record.kind === 'instant'),
        ).length
      const prepared = await succeed(['review', '--yes', '--allow-resolution-network'])
      expect(count(prepared, 'dependency-preparation')).toBe(1)
      const runDependency = async () =>
        JSON.parse(
          (await succeed(['run', 'binding:dependencies', '--input', '"checked"', '--json'])).stdout,
        )
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { input: 'checked', value: 1, settings: { phase: 'first' } },
      })
      const unchanged = await succeed(['review', '--yes'])
      expect(count(unchanged, 'dependency-preparation')).toBe(0)
      expect(count(unchanged, 'dependency-reuse')).toBe(1)
      await put('libs/helper/index.ts', 'export const value = 2;')
      await rm(join(project, 'libs/helper/removed.txt'))
      await put('libs/helper/added.txt', 'new resource')
      // Until review, execution still uses the old admitted source.
      expect(await runDependency()).toMatchObject({ output: { value: 1 } })
      const edited = await succeed(['review', '--yes'])
      expect(count(edited, 'dependency-preparation')).toBe(0)
      expect(count(edited, 'dependency-reuse')).toBe(1)
      expect(edited.stdout).toContain('Prepared execution files or dependency layout changed')
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'first' } },
      })
      await put('bindings/dependencies.ts', binding('second'))
      const settingsChanged = await succeed(['review', '--yes'])
      expect(count(settingsChanged, 'dependency-preparation')).toBe(0)
      expect(count(settingsChanged, 'dependency-reuse')).toBe(1)
      expect(await runDependency()).toMatchObject({
        output: { value: 2, settings: { phase: 'second' } },
      })
      // Five independent Bindings still perform bootstrap and complete-closure
      // evaluation. Only their envelope setup is shared; public Run uses each
      // declaration's freshly checked settings, not an evaluated-value cache.
      for (let index = 0; index < 4; index += 1)
        await put(`bindings/peer${index}.ts`, binding(`peer-${index}`))
      const manyBindings = await succeed(['review', '--yes'])
      expect(count(manyBindings, 'author-envelope-startup')).toBe(2)
      expect(count(manyBindings, 'dependency-preparation')).toBe(0)
      expect(count(manyBindings, 'dependency-reuse')).toBe(1)
      const peer = JSON.parse(
        (await succeed(['run', 'binding:peer3', '--input', '"checked"', '--json'])).stdout,
      )
      expect(peer).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'peer-3' } },
      })
      await put('bindings/bad.ts', 'throw new Error("inert fixture failure"); export default {};')
      const refused = await invoke(['review', '--yes'])
      expect(refused.exit).not.toBe(0)
      expect(refused.stderr).toContain('bindings/bad.ts')
      expect(await runDependency()).toMatchObject({
        output: { value: 2, settings: { phase: 'second' } },
      })
      await rm(join(project, 'bindings/bad.ts'))
      await put('libs/helper/package.json', {
        name: 'helper',
        type: 'module',
        exports: './index.ts',
        description: 'Changed installer input',
      })
      const missingPermission = await invoke(['review', '--yes'])
      expect(missingPermission.exit).not.toBe(0)
      expect(missingPermission.stderr).toContain('PACKAGE_BUN_RESOLUTION_PERMISSION_REQUIRED')
      const dependencyChanged = await succeed(['review', '--yes', '--allow-resolution-network'])
      expect(count(dependencyChanged, 'dependency-preparation')).toBe(1)
      expect(count(dependencyChanged, 'dependency-reuse')).toBe(0)
      expect(await runDependency()).toMatchObject({
        status: 'succeeded',
        output: { value: 2, settings: { phase: 'second' } },
      })
      passed = true
    } finally {
      if (passed) await rm(directory, { recursive: true, force: true })
      else console.error(`Packed ${scenario} consumer evidence retained at ${directory}`)
    }
  }, 600000)
}

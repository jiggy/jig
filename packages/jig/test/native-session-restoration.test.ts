import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { settleTestCommand } from './fixtures/bounded-command.js'

// Opt-in installed public CLI qualification using the operator's Codex subscription.
// At most two one-turn model calls; only synthetic facts, no tools or automatic retries.
// Requires prepared archives and the provisioned native containment host.
const qualified = process.env.JIG_NATIVE_AGENT_RESTORE === '1' ? test : test.skip
qualified(
  'restores a clean native conversation in a fresh installed Run, consumes the reference once',
  async () => {
    const archives = process.env.JIG_RESTORE_ARCHIVES
    const codex = process.env.JIG_CODEX_STARTUP_PATH
    const model = process.env.JIG_RESTORE_MODEL
    if (!archives || !codex || !model)
      throw new Error('Supply JIG_RESTORE_ARCHIVES, JIG_CODEX_STARTUP_PATH and JIG_RESTORE_MODEL')
    const root = await mkdtemp(join(tmpdir(), 'jig-native-restore-'))
    // Preserve both successful and unsuccessful qualification evidence.
    console.info(`Native restoration evidence: ${root}`)
    const fact = crypto.randomUUID()
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_PATH: codex,
      CODEX_MODEL: model,
    }
    for (const key of ['OPENAI_MODEL', 'OPENAI_API', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'])
      delete environment[key]
    const command = async (args: string[], cwd: string, name: string, allowedFailure = false) => {
      const child = Bun.spawn(args, { cwd, env: environment, stdout: 'pipe', stderr: 'pipe' })
      const result = await settleTestCommand(child, { evidence: join(root, name) })
      if (!allowedFailure) expect(result.code, `${name}: ${result.stderr}`).toBe(0)
      return result
    }
    const names = await readdir(archives)
    for (const [name, target] of [
      ['jig', 'cli'],
      ['flow', 'packages/flow'],
      ['agent-method', 'packages/agent-method'],
      ['agent-acp', 'packages/agent-acp'],
    ] as const) {
      const archive = names.find(
        (file) => file.startsWith(`jigging-${name}-`) && file.endsWith('.tgz'),
      )
      if (!archive) throw new Error(`Missing ${name} archive`)
      await mkdir(join(root, target), { recursive: true })
      await command(
        [
          'tar',
          '-xzf',
          resolve(archives, archive),
          '--strip-components=1',
          '-C',
          join(root, target),
        ],
        root,
        `extract-${name}`,
      )
    }
    await mkdir(join(root, 'app/flows/restore'), { recursive: true })
    await mkdir(join(root, 'app/bindings'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ private: true, workspaces: ['packages/*', 'app', 'app/flows/*'] }),
    )
    await writeFile(
      join(root, 'app/package.json'),
      JSON.stringify({
        name: 'native-restoration-consumer',
        private: true,
        type: 'module',
        dependencies: { '@jigging/agent-acp': 'workspace:*' },
      }),
    )
    await writeFile(
      join(root, 'app/flows/restore/package.json'),
      JSON.stringify({
        name: 'restore-consumer',
        private: true,
        type: 'module',
        dependencies: { '@jigging/flow': 'workspace:*' },
      }),
    )
    // The consumer declares its local dependency using ordinary workspace files.
    // The exact Agent contract bundle comes from the installed Agent artifact.
    await command(
      [
        'cp',
        '-R',
        join(root, 'packages/agent-acp/contracts'),
        join(root, 'app/flows/restore/contracts'),
      ],
      root,
      'copy-channels',
    )
    await writeFile(
      join(root, 'app/flows/restore/agent.json'),
      await readFile(join(root, 'packages/agent-acp/FLOW.contract.json')),
    )
    await writeFile(
      join(root, 'app/flows/restore/FLOW.meta.json'),
      JSON.stringify({ uses: { agent: { contract: './agent.json' } } }),
    )
    await writeFile(
      join(root, 'app/flows/restore/FLOW.ts'),
      `import {handle} from '@jigging/flow'; await handle(async run => await run.call({operationId:'agent',slot:'agent',input:run.input}));`,
    )
    await writeFile(
      join(root, 'app/bindings/agent.ts'),
      `import {defineBinding} from '@jigging/jig'; export default defineBinding({package:'npm:@jigging/agent-acp',slots:{native:{kind:'acp',client:'codex',retainSessions:true}}});`,
    )
    await writeFile(
      join(root, 'app/jig.ts'),
      `import {defineJig,discover} from '@jigging/jig'; export default defineJig({flows:discover('flows'),bindings:discover('bindings'),defaultProviders:{'https://jig.md/contracts/agent-run':'binding:agent'}});`,
    )
    await command(
      [process.execPath, '--no-env-file', 'install', '--ignore-scripts', '--config=/dev/null'],
      join(root, 'cli'),
      'cli-install',
    )
    await command(
      [process.execPath, '--no-env-file', 'install', '--ignore-scripts', '--config=/dev/null'],
      root,
      'workspace-install',
    )
    const cli = join(root, 'cli/bin/jig'),
      app = join(root, 'app')
    await command([cli, 'review', '--yes', '--allow-authority-changes'], app, 'review')
    await writeFile(
      join(app, 'first.json'),
      JSON.stringify({
        instructions: `Remember this incident code for later: ${fact}. Reply only stored.`,
        session: { retain: true },
      }),
    )
    const first = JSON.parse(
      (
        await command(
          [
            cli,
            'run',
            'flow:flows/restore',
            '--input',
            '@first.json',
            '--timeout',
            '90s',
            '--json',
          ],
          app,
          'first',
        )
      ).stdout,
    )
    expect(first.status).toBe('succeeded')
    expect(first.output.session.status).toBe('retained')
    expect(first.output.text).not.toContain(codex)
    const reference = first.output.session.reference
    await writeFile(
      join(app, 'second.json'),
      JSON.stringify({
        instructions:
          'Return only the incident code from our previous conversation, without explanation.',
        session: { restore: reference },
      }),
    )
    const second = JSON.parse(
      (
        await command(
          [
            cli,
            'run',
            'flow:flows/restore',
            '--input',
            '@second.json',
            '--timeout',
            '90s',
            '--json',
          ],
          app,
          'second',
        )
      ).stdout,
    )
    expect(second.status).toBe('succeeded')
    expect(second.output.session.status).toBe('retained')
    expect(second.output.session.reference).not.toBe(reference)
    expect(second.output.text).toContain(fact)
    expect(second.output.text).not.toContain(codex)
    const reused = await command(
      [cli, 'run', 'flow:flows/restore', '--input', '@second.json', '--timeout', '30s', '--json'],
      app,
      'reused',
      true,
    )
    expect(reused.code).not.toBe(0)
    expect(JSON.parse(reused.stdout).status).toBe('failed')
    await writeFile(
      join(root, 'assertions.json'),
      JSON.stringify({
        crossRun: true,
        retainedContext: true,
        referenceConsumed: true,
        maximumAuthorizedModelCalls: 2,
      }),
    )
  },
  360_000,
)

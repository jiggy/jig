import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateAcpAgentProvider } from '../../src/internal/acp-agent-provider.js'
import { withPrivateInstallationVerification } from '../../src/internal/installation-verification.js'
import { openPrivateInstalledBunHost } from '../../src/internal/installed-bun-host.js'
import { openPrivateAcpResources } from '../../src/internal/private-acp-resources.js'
import { openPrivateProjectSession } from '../../src/internal/project-session-controller.js'
import { fixtureHost, MACOS_FIXTURE_SETTLEMENT_MS } from '../fixtures/agent-fixture-host.js'
import { installedBunLocation } from '../fixtures/installed-bun-location.js'
import {
  expectNoAgentOwner,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForCgroups,
  waitForTemporaryState,
  waitForTerminal,
  writeProject,
} from '../fixtures/root-agent-lifecycle.js'

if (
  !(
    (process.platform === 'linux' && process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1') ||
    (process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1')
  )
) {
  throw new Error('This suite requires an opted-in native Linux or macOS host')
}

test(
  'ordinary ACP method preserves a closed request diagnostic after real host fencing',
  () =>
    withPrivateInstallationVerification({}, async () => {
      const initialCgroups = new Set(await rootlessCgroups())
      const initialTemporaryState = new Set(
        (await readdir(tmpdir())).filter(rootlessTemporaryEntry),
      )
      const workspace = await mkdtemp(join(await realpath(tmpdir()), 'jig-native-diagnostic-'))
      const root = join(workspace, 'project')
      let session: Awaited<ReturnType<typeof openPrivateProjectSession>> | undefined
      try {
        await writeProject(root)
        const destination = join(root, 'flows/native-method')
        const artifacts = join(workspace, 'artifacts')
        await mkdir(destination)
        await mkdir(artifacts)
        let archive = process.env.AGENT_ACP_PACKAGE_ARCHIVE
        if (archive === undefined) {
          const pack = Bun.spawn(
            [
              process.execPath,
              '--no-env-file',
              'pm',
              'pack',
              '--ignore-scripts',
              '--destination',
              artifacts,
            ],
            {
              cwd: join(import.meta.dir, '../../../agent-acp'),
              stdout: 'pipe',
              stderr: 'pipe',
            },
          )
          const [code, stdout, stderr] = await Promise.all([
            pack.exited,
            new Response(pack.stdout).text(),
            new Response(pack.stderr).text(),
          ])
          expect(code, `${stdout}\n${stderr}`).toBe(0)
          const files = (await readdir(artifacts)).filter((file) => file.endsWith('.tgz'))
          expect(files).toHaveLength(1)
          archive = join(artifacts, files[0]!)
        }
        const extract = Bun.spawn(
          ['tar', '-xzf', await realpath(archive), '--strip-components=1', '-C', destination],
          { stdout: 'pipe', stderr: 'pipe' },
        )
        const [code, stderr] = await Promise.all([
          extract.exited,
          new Response(extract.stderr).text(),
        ])
        expect(code, stderr).toBe(0)
        await mkdir(join(root, 'bindings'))
        await writeFile(
          join(root, 'jig.ts'),
          `import {defineJig, discover} from '@jigging/jig';
        export default defineJig({flows: discover('flows'), bindings: discover('bindings')});`,
        )
        await writeFile(
          join(root, 'bindings/agent.ts'),
          `import {defineBinding} from '@jigging/jig';
        export default defineBinding({package: 'flows/native-method',
          settings: {recovery: {beforePrompt: 'stop'}}, slots: {native: {kind: 'acp', client: 'codex'}}});`,
        )
        await writeFile(
          join(root, 'bindings/caller.ts'),
          `import {defineBinding} from '@jigging/jig';
        export default defineBinding({package: 'flows/router', slots: {agent: 'binding:agent'}});`,
        )
        await writeFile(
          join(root, 'flows/router/FLOW.contract.json'),
          JSON.stringify({
            $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
            input: { type: 'null' },
          }),
        )
        await writeFile(
          join(root, 'flows/router/FLOW.ts'),
          `import {handle, OperationError} from './flow-sdk/index.js';
        await handle(async run => {
          try { return await run.call({operationId: 'agent', slot: 'agent', input: {instructions: 'Never forwarded'}}); }
          catch (error) {
            if (!(error instanceof OperationError)) throw error;
            return {outcome: 'done', output: {code: error.code, message: error.message, details: error.details}};
          }
        });`,
        )
        const adapterPath = join(workspace, 'peer.ts')
        // Controlled wire producer, not Codex qualification. Admission, captured
        // artifacts, subprocess ownership, fencing and cleanup are production paths.
        await writeFile(
          adapterPath,
          `import {createInterface} from 'node:readline';
        for await (const line of createInterface({input: process.stdin})) {
          const frame = JSON.parse(line);
          const reply = value => process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: frame.id, ...value}) + '\\n');
          if (frame.method === 'initialize') reply({result: {protocolVersion: 2,
            capabilities: {session: {}}, info: {name: 'controlled-peer', version: '2'}}});
          else if (frame.method === 'session/new') reply({error: {code: -32603, message: 'Internal error',
            data: 'failed to load configuration: Failed to synchronize managed preferences\\n\\nCheck /private/secret-canary'}});
          else throw new Error('Unexpected request');
        }`,
        )
        const installed = await openPrivateInstalledBunHost(installedBunLocation, {}, root)
        const host = fixtureHost({
          ...installed,
          acpResources: openPrivateAcpResources(installed.installedBunSupport, {}, root, async () =>
            createPrivateAcpAgentProvider({
              client: 'openai-codex',
              model: 'controlled-peer',
              credentialMode: 'controlled-peer',
              adapterPath,
              sandboxAdapterPath: '/agent/peer.ts',
              executablePath: installed.installedBunSupport.executablePath,
              sandboxExecutablePath: '/agent/peer-bun',
              environment: {},
            }),
          ),
        })
        session = await openPrivateProjectSession({
          directory: root,
          host,
          onOperationFailure: (evidence) =>
            console.error('native-diagnostic-operation-failure', JSON.stringify(evidence)),
          onRootExecutionFailure: (evidence) =>
            console.error('native-diagnostic-execution-failure', JSON.stringify(evidence)),
        })
        const plan = await session.plan({ lockMode: 'update' })
        if (plan.state !== 'applicable')
          throw new Error('Diagnostic consumer has no applicable Plan')
        await session.apply({ planDigest: plan.planDigest })
        const receipt = await session.rootAdministration.startRun({
          submissionId: 'native-diagnostic',
          target: { kind: 'binding', id: 'caller' },
          input: null,
        })
        const result = await waitForTerminal(session.rootAdministration, receipt)
        expect(result).toMatchObject({
          state: 'terminal',
          terminal: {
            status: 'succeeded',
            output: {
              code: 'EXECUTION_FAILED',
              details: {
                nativeRequest: {
                  method: 'session/new',
                  code: -32603,
                  reason: 'managed-preferences-unavailable',
                },
                nativePrompt: {
                  forwarding: 'not-forwarded',
                  cleanup: 'confirmed',
                  turnsSettled: 0,
                },
              },
            },
          },
        })
        if (result.state !== 'terminal' || result.terminal.status !== 'succeeded')
          throw new Error('Diagnostic consumer failed')
        expect(JSON.stringify(result.terminal.output)).toContain(
          'macOS managed preferences could not be synchronized',
        )
        expect(JSON.stringify(result.terminal.output)).not.toMatch(/secret-canary|\/private/)
        await expectNoAgentOwner(root)
        await session.close()
        session = undefined
        await waitForCgroups(initialCgroups)
        await waitForTemporaryState(initialTemporaryState)
      } finally {
        await session?.close()
        await rm(workspace, { recursive: true, force: true })
      }
    }),
  MACOS_FIXTURE_SETTLEMENT_MS + 120_000,
)

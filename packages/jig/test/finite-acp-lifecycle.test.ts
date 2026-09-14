import { describe, expect, test } from 'bun:test'
import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, type PrivateCliOptions } from '../src/cli.js'
import { openPrivateProjectSession } from '../src/internal/project-session-controller.js'
import { installedBunLocation } from './fixtures/installed-bun-location.js'
import { qualifyIncidentBrief } from './fixtures/incident-brief-consumer.js'
import { writeOrdinaryAcpAgent, writeConversationCaller } from './fixtures/ordinary-acp-agent.js'
import {
  openDeterministicFiniteAcpHost,
  writeDeterministicAcpAgent,
} from './fixtures/deterministic-acp-agent.js'

const proof = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1' ? describe.serial : describe.skip

// The external native peer is deterministic; package, channels, authentication
// mediation, command owner, containment and cleanup are the production path.
proof('ordinary packed ACP Agent with a finite resource', () => {
  test(
    'hands off a drafting conversation while an independent worker progresses',
    qualifyIncidentBrief,
    180_000,
  )
  test('returns checked text and live updates, rejects malformed work, and settles cancellation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jig-finite-acp-proof-'))
    const project = join(root, 'project')
    const release = join(root, 'release')
    const key = 'synthetic-finite-acp-only-key'
    const events: any[] = []
    let cancellation: AbortController | undefined
    const before = await cgroups()
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        expect(new URL(request.url).pathname).toBe('/dispatch')
        expect(request.headers.get('authorization')).toBe(`Bearer ${key}`)
        const event = (await request.json()) as any
        events.push(event)
        if (event.scenario === 'slow') setTimeout(() => cancellation?.abort(), 100)
        return new Response('recorded')
      },
    })
    let clean = false
    try {
      await mkdir(project)
      await cp(join(installedBunLocation.releaseRoot, 'libexec'), join(release, 'libexec'), {
        recursive: true,
      })
      const executablePath = await realpath(installedBunLocation.executablePath)
      await mkdir(join(release, 'node_modules/@oven/bun-linux-x64-baseline/bin'), {
        recursive: true,
      })
      await symlink(
        executablePath,
        join(release, 'node_modules/@oven/bun-linux-x64-baseline/bin/bun'),
      )
      const location = {
        releaseRoot: release,
        executablePath,
        installedCliPath: join(release, 'libexec/installed-cli.js'),
      }
      await writeDeterministicAcpAgent(release)
      await writeOrdinaryAcpAgent(project, 'codex', 3)
      await writeConversationCaller(project)
      const host = await openDeterministicFiniteAcpHost(
        location,
        {
          METHOD_TEST_TOKEN: key,
          ACP_TEST_ENDPOINT: `http://127.0.0.1:${server.port}/dispatch`,
        },
        project,
      )
      let stdout = '',
        stderr = ''
      const options: PrivateCliOptions = {
        currentDirectory: project,
        interactive: false,
        writeOutput(text) {
          stdout += text
        },
        writeRecord: async (text) => {
          stdout += text
        },
        writeError(text) {
          stderr += text
        },
        host: {
          acquire: (directory, overrides) =>
            openPrivateProjectSession({ directory, host: { ...host, ...overrides } }),
        },
      }
      expect(await main(['review', '--yes', '--allow-authority-changes'], options), stderr).toBe(0)
      expect(stdout).toContain('acp')
      expect(stdout).not.toContain(key)
      for (const scenario of ['success', 'schema-invalid', 'malformed', 'slow']) {
        stdout = ''
        stderr = ''
        cancellation = new AbortController()
        const responseSchema = {
          $schema: 'https://flow.jig.md/schemas/schema-1.json',
          type: 'object',
          properties: {
            decision: {
              type: 'object',
              properties: {
                route: { type: 'string', enum: ['technical'] },
                evidence: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: {
                    type: 'object',
                    properties: {
                      keyLocation: { type: 'string', enum: ['stdin'] },
                      selectedSkill: { type: 'string', enum: ['absent'] },
                      hiddenSkill: { type: 'string', enum: ['absent'] },
                      sourceLine: { type: 'integer' },
                      amount: { type: ['integer', 'null'] },
                    },
                    required: [
                      'keyLocation',
                      'selectedSkill',
                      'hiddenSkill',
                      'sourceLine',
                      'amount',
                    ],
                    additionalProperties: false,
                  },
                },
                ambiguity: { type: ['string', 'null'] },
              },
              required: ['route', 'evidence', 'ambiguity'],
              additionalProperties: false,
            },
          },
          required: ['decision'],
          additionalProperties: false,
        }
        const code = await main(
          [
            'run',
            'binding:agent',
            '--input',
            JSON.stringify({ instructions: `scenario:${scenario}`, responseSchema }),
            '--receive',
            'events',
            '--json',
            '--timeout',
            '30s',
          ],
          { ...options, signal: cancellation.signal },
        )
        const records = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
        const terminal = records.find((record) => record.type === 'terminal')
        if (scenario === 'slow') {
          expect(code, `${stdout}\n${stderr}`).not.toBe(0)
          expect(stderr).toContain('JIG_COMMAND_INTERRUPTED')
          expect(
            records.some((record) => record.type === 'end' && record.status === 'failed'),
          ).toBe(true)
          // Cancellation may settle the command without a terminal report.
          if (terminal !== undefined) expect(terminal.result.status).toBe('failed')
        } else if (scenario === 'success') {
          expect(terminal, `${stdout}\n${stderr}`).toBeDefined()
          expect(code, `${stdout}\n${stderr}`).toBe(0)
          expect(terminal.result.status).toBe('succeeded')
          expect(terminal.result.output.structured.decision.route).toBe('technical')
          expect(records.some((record) => record.type === 'data')).toBe(true)
          expect(records.findIndex((record) => record.type === 'data')).toBeLessThan(
            records.indexOf(terminal),
          )
        } else {
          expect(terminal, `${stdout}\n${stderr}`).toBeDefined()
          expect(code, `${stdout}\n${stderr}`).not.toBe(0)
          expect(terminal.result.status).toBe('failed')
        }
        expect(stdout).not.toContain(key)
        expect(stderr).not.toContain(key)
        await settledCgroups(before)
        for (const name of ['private-root-linux-owners', 'private-root-materializations']) {
          const entries = await readdir(join(project, '.jig', name))
          expect(entries.filter((entry) => /^(a-|c-|x-|child-)/.test(entry))).toEqual([])
        }
      }
      stdout = ''
      stderr = ''
      cancellation = undefined
      const conversationCode = await main(
        [
          'run',
          'flow:flows/conversation',
          '--input',
          JSON.stringify({
            first: 'scenario:success',
            followups: ['scenario:slow', 'scenario:success'],
            interrupt: 1,
          }),
          '--json',
          '--timeout',
          '45s',
        ],
        options,
      )
      expect(conversationCode, `${stdout}\n${stderr}`).toBe(0)
      const conversation = JSON.parse(stdout)
      expect(conversation.output.conversation).toEqual({ outcome: 'done', output: { turns: 3 } })
      expect(
        conversation.output.records
          .filter((record: any) => record.type === 'result')
          .map((record: any) => record.turn),
      ).toEqual([0, 2])
      expect(conversation.output.records).toContainEqual({ type: 'cancelled', turn: 1 })
      await settledCgroups(before)
      expect(events.map((event) => event.scenario)).toEqual([
        'success',
        'schema-invalid',
        'malformed',
        'slow',
        'success',
        'slow',
        'success',
      ])
      expect(events.every((event) => event.keyInEnvironment === false)).toBe(true)
      // The selected runtime is outside package source but still pinned by
      // admission. Neither a cached private provider nor a freshly inspected
      // replacement may dispatch changed native bytes under the old approval.
      await appendFile(
        join(release, 'libexec/agent/fixture-acp.js'),
        '\n// changed native identity\n',
      )
      const replacementHost = await openDeterministicFiniteAcpHost(
        location,
        {
          METHOD_TEST_TOKEN: key,
          ACP_TEST_ENDPOINT: `http://127.0.0.1:${server.port}/dispatch`,
        },
        project,
      )
      for (const selectedHost of [host, replacementHost]) {
        stdout = ''
        stderr = ''
        const code = await main(
          ['run', 'binding:agent', '--input', '{"instructions":"scenario:success"}', '--json'],
          {
            ...options,
            host: {
              acquire: (directory, overrides) =>
                openPrivateProjectSession({ directory, host: { ...selectedHost, ...overrides } }),
            },
          },
        )
        expect(code, `${stdout}\n${stderr}`).not.toBe(0)
        expect(events).toHaveLength(7)
        expect(stdout + stderr).not.toContain(key)
        await settledCgroups(before)
      }
      clean = true
    } finally {
      await server.stop(true)
      if (clean) await rm(root, { recursive: true, force: true })
      else console.error(`Finite ACP proof failed; retained ${root}`)
    }
  }, 180_000)
})

async function cgroups(): Promise<string[]> {
  const path = process.env.AGENT_DELEGATED_CGROUP
  if (!path) throw new Error('The finite ACP proof requires a delegated host')
  return (await readdir(path)).filter((name) => name.startsWith('jig-run-')).sort()
}

async function settledCgroups(expected: readonly string[]): Promise<void> {
  const deadline = Date.now() + 10_000
  do {
    if (JSON.stringify(await cgroups()) === JSON.stringify(expected)) return
    await Bun.sleep(20)
  } while (Date.now() < deadline)
  expect(await cgroups()).toEqual(expected)
}

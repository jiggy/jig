import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectPlanResult, ProjectSession } from '../../src/administration/project.js'
import { main, type PrivateCliCommandHost, type PrivateCliOptions } from '../../src/cli.js'
import type {
  PrivateAgentReadinessIssue,
  PrivateAgentReadinessReport,
} from '../../src/internal/review-agent-setup.js'

const issue: PrivateAgentReadinessIssue = {
  source: 'inline',
  location: { path: 'bindings/model.ts', line: 5, column: 33, kind: 'client-literal' },
  declaration: 'bindings/model.ts',
  slot: 'native',
  client: 'pi',
  sourceClient: 'pi',
  policy: { kind: 'acp', client: 'pi' },
  code: 'PROJECT_ACP_PI_EXECUTABLE',
  recipients: [{ binding: 'model', declaration: 'bindings/model.ts', slot: 'native' }],
  omittedRecipients: 0,
  observedRefusals: 1,
  alternatives: ['codex'],
}
const blocked: PrivateAgentReadinessReport = {
  selectedAcpUnavailable: true,
  primaryIssue: issue,
  observedIssues: 1,
  observedPolicyGroups: 1,
  uncheckedResources: 0,
  complete: true,
  omittedPolicyGroups: 0,
  issues: [issue],
  selections: [],
  omittedSelections: 0,
}
const ready: PrivateAgentReadinessReport = {
  ...blocked,
  selectedAcpUnavailable: false,
  primaryIssue: undefined,
  observedIssues: 0,
  observedPolicyGroups: 0,
  issues: [],
  selections: [
    {
      ...issue.recipients[0]!,
      sourceClient: 'pi',
      effectiveClient: 'codex',
      source: issue.location,
    },
  ],
}
function plan(unchanged = false): ProjectPlanResult {
  return unchanged
    ? { state: 'unchanged' }
    : {
        state: 'applicable',
        operation: 'admission',
        planDigest: `sha256:${'1'.repeat(64)}`,
        review: {
          mediaType: 'text/plain; charset=utf-8',
          text: 'Exact candidate\n',
          details: 'Full candidate\n',
          authorityChanges: true,
        },
      }
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-review-setup-'))
  try {
    await writeFile(join(root, 'jig.ts'), 'captured authored source')
    await writeFile(join(root, 'jig.lock'), 'previous exact approval')
    await run(root)
    expect(await readFile(join(root, 'jig.ts'), 'utf8')).toBe('captured authored source')
    expect(await readFile(join(root, 'jig.lock'), 'utf8')).toBe('previous exact approval')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
function invocation(
  root: string,
  host: PrivateCliCommandHost,
  extra: Partial<PrivateCliOptions> = {},
) {
  const output: string[] = [],
    errors: string[] = []
  return {
    output,
    errors,
    options: {
      currentDirectory: root,
      host,
      terminalError: false,
      terminalOutput: false,
      writeOutput: (text: string) => {
        output.push(text)
      },
      writeError: (text: string) => {
        errors.push(text)
      },
      ...extra,
    } satisfies PrivateCliOptions,
  }
}
function hostWith(
  report: PrivateAgentReadinessReport | undefined,
  events: string[],
  unchanged = false,
  closeFails = false,
): PrivateCliCommandHost {
  return {
    async acquire(_project, options) {
      events.push(`acquire:${options?.agentOverride ?? 'source'}`)
      return {
        rootAdministration: {} as ProjectSession['rootAdministration'],
        async plan() {
          events.push('qualification')
          if (report) options?.onAgentReadiness?.(report)
          events.push('preparation')
          return plan(unchanged)
        },
        async apply() {
          events.push('apply')
          return { operation: 'admission', planDigest: `sha256:${'1'.repeat(64)}` }
        },
        async close() {
          events.push('close')
          if (closeFails) throw new Error('private close fault')
        },
      }
    },
  }
}
describe('review prerequisite refusal and explicit client selection', () => {
  test('observed refusal stops preparation and approval for interactive, automated, details and unchanged review', async () => {
    for (const args of [
      ['review'],
      ['review', '--details'],
      ['review', '--yes', '--allow-authority-changes'],
    ]) {
      for (const unchanged of [false, true])
        await fixture(async (root) => {
          const events: string[] = []
          const run = invocation(root, hostWith(blocked, events, unchanged), {
            interactive: true,
            answer: async () => {
              throw new Error('no client chooser')
            },
            confirm: async () => {
              throw new Error('no approval prompt')
            },
          })
          expect(await main(args, run.options)).toBe(2)
          expect(events).toEqual(['acquire:source', 'qualification', 'close'])
          expect(run.errors.join('')).toContain('Review could not finish')
          expect(run.errors.join('')).toContain('bindings/model.ts')
          expect(run.errors.join('')).toContain('Any existing approval remains unchanged')
          expect(run.output.join('')).not.toContain('Project ready')
          expect(run.output.join('')).not.toContain('Exact candidate')
        })
    }
  })
  test('omitted policy rows do not erase a primary refusal', async () =>
    fixture(async (root) => {
      const events: string[] = []
      const run = invocation(
        root,
        hostWith({ ...blocked, issues: [], omittedPolicyGroups: 1, complete: false }, events),
      )
      expect(await main(['review', '--yes'], run.options)).toBe(2)
      expect(events).not.toContain('apply')
      expect(run.errors.join('')).toContain('Pi is selected')
    }))
  test('other feature unavailability is not an ACP refusal; unchanged review succeeds', async () =>
    fixture(async (root) => {
      const events: string[] = []
      const run = invocation(
        root,
        hostWith(
          { ...ready, selections: [], complete: false, uncheckedResources: 1 },
          events,
          true,
        ),
      )
      expect(await main(['review'], run.options)).toBe(0)
      expect(events).toEqual(['acquire:source', 'qualification', 'preparation', 'close'])
      expect(run.errors.join('')).not.toContain('Review could not finish')
    }))
  test('cleanup failure still prevents success and hides private cause', async () =>
    fixture(async (root) => {
      const events: string[] = []
      const run = invocation(root, hostWith(blocked, events, false, true))
      expect(await main(['review'], run.options)).toBe(2)
      expect(events).not.toContain('apply')
      expect(run.errors.join('')).toContain('JIG_CLEANUP_FAILED')
      expect(run.errors.join('')).not.toContain('private close fault')
    }))
  test('review-only required enum rejects missing, repeated and unsupported operands before acquisition', async () =>
    fixture(async (root) => {
      for (const args of [
        ['review', '--agent'],
        ['review', '--agent', 'unknown'],
        ['review', '--agent', 'pi', '--agent', 'codex'],
        ['run', '--agent', 'codex'],
      ]) {
        const events: string[] = []
        const run = invocation(root, hostWith(ready, events), {
          interactive: true,
          answer: async () => {
            throw new Error('no chooser')
          },
        })
        expect(await main(args, run.options)).toBe(2)
        expect(events).toEqual([])
      }
    }))
  test('explicit selection reaches ordinary approval and is absent from the next bare review', async () =>
    fixture(async (root) => {
      const events: string[] = []
      const run = invocation(root, hostWith(ready, events), {
        interactive: true,
        confirm: async () => {
          events.push('confirm')
          return true
        },
      })
      expect(await main(['review', '--agent', 'codex'], run.options)).toBe(0)
      expect(events).toEqual([
        'acquire:codex',
        'qualification',
        'preparation',
        'confirm',
        'apply',
        'close',
      ])
      expect(run.errors.join('')).toContain('source "pi" -> effective "codex"')
      expect(run.errors.join('')).toContain('every selected ACP')
      events.length = 0
      const next = invocation(root, hostWith(blocked, events))
      expect(await main(['review'], next.options)).toBe(2)
      expect(events[0]).toBe('acquire:source')
    }))
  test('the client flag does not bypass authority approval; refusal retry preserves only explicit options', async () =>
    fixture(async (root) => {
      const events: string[] = []
      const run = invocation(root, hostWith(ready, events))
      expect(await main(['review', '--agent', 'codex', '--yes'], run.options)).toBe(2)
      expect(events).not.toContain('apply')
      expect(run.errors.join('')).toContain('JIG_AUTHORITY_APPROVAL_REQUIRED')
      const refusal = invocation(root, hostWith(blocked, []))
      expect(
        await main(
          [
            'review',
            '--agent',
            'pi',
            '--allow-resolution-network',
            '--generate-contracts',
            '--verification',
            'strict',
            '--yes',
          ],
          refusal.options,
        ),
      ).toBe(2)
      expect(refusal.errors.join('')).toContain(
        '$ jig review --agent pi --allow-resolution-network --generate-contracts --verification strict',
      )
      expect(refusal.errors.join('')).not.toContain('--yes')
    }))
})

test('successful feature-only unavailable reviews give an honest final next step', async () => {
  for (const count of [0, 1])
    await fixture(async (root) => {
      const events: string[] = []
      const report = {
        ...ready,
        readyTargets: count,
        unavailableTargets: 1,
        entrypoint: {
          target: { kind: 'binding' as const, id: 'work' },
          state: 'unavailable' as const,
        },
      }
      const run = invocation(root, hostWith(report, events), {
        interactive: true,
        confirm: async () => true,
      })
      expect(await main(['review'], run.options)).toBe(0)
      expect(events).toContain('apply')
      expect(run.output.join('')).toContain('Review recorded')
      expect(run.output.join('')).toContain('$ jig inspect')
      expect(run.output.join('')).not.toContain('Project ready')
      expect(run.output.join('')).not.toContain('$ jig run\n')
    })
})

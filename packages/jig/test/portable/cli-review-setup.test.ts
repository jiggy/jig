import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import {
  renderReviewAgentSelections,
  renderReviewAgentSetup,
} from '../../src/cli-review-agent-setup.js'
import type { PrivateAgentReadinessReport } from '../../src/internal/review-agent-setup.js'

test('review-only required enum rejects missing, repeated and unsupported operands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-cli-review-grammar-'))
  try {
    for (const args of [
      ['review', '--agent'],
      ['review', '--agent', 'unknown'],
      ['review', '--agent', 'pi', '--agent', 'codex'],
      ['run', '--agent', 'codex'],
    ]) {
      const errors: string[] = []
      expect(
        await main(args, {
          currentDirectory: root,
          terminalError: false,
          terminalOutput: false,
          writeOutput: () => {},
          writeError: (text) => errors.push(text),
        }),
      ).toBe(2)
      expect(errors.join('')).toContain('--agent')
      expect(errors.join('')).not.toContain('JIG_HOST_UNAVAILABLE')
      expect(await readdir(root)).toEqual([])
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// Ordinary data exercises rendering only. No report is supplied to a session.
const issue = {
  source: 'inline' as const,
  location: { path: 'bindings/model.ts', line: 5, column: 33, kind: 'client-literal' as const },
  declaration: 'bindings/model.ts',
  slot: 'native',
  client: 'pi' as const,
  sourceClient: 'pi' as const,
  policy: { kind: 'acp' as const, client: 'pi' as const },
  code: 'PROJECT_ACP_PI_EXECUTABLE' as const,
  recipients: [{ binding: 'model', declaration: 'bindings/model.ts', slot: 'native' }],
  omittedRecipients: 0,
  observedRefusals: 1,
  alternatives: ['codex' as const],
}
const blocked: PrivateAgentReadinessReport = {
  selectedAcpUnavailable: true,
  primaryIssue: issue,
  observedIssues: 1,
  observedPolicyGroups: 1,
  uncheckedResources: 0,
  complete: false,
  omittedPolicyGroups: 1,
  issues: [],
  selections: [],
  omittedSelections: 0,
}

test('omitted policy rows do not erase the primary refusal from rendering', () => {
  for (const details of [false, true]) {
    const text = renderReviewAgentSetup(blocked, {
      details,
      retryCommand: 'jig review',
      agentRetryCommands: {
        codex: 'jig review --agent codex',
        claude: 'jig review --agent claude',
        pi: 'jig review --agent pi',
      },
    })
    expect(text).toContain(details ? 'Pi is selected' : 'Pi executable not found')
    expect(text).toContain('bindings/model.ts')
    expect(text).toContain(
      details ? 'Any existing approval remains unchanged' : 'Previous approval unchanged',
    )
    if (!details) {
      expect(text).toContain('$ jig review --agent codex')
      expect(text).toContain('login and readiness not checked')
    }
  }
})

test('non-ACP unavailability is not rendered as an ACP refusal', () => {
  expect(
    renderReviewAgentSetup(
      { ...blocked, selectedAcpUnavailable: false, primaryIssue: undefined, uncheckedResources: 1 },
      {
        details: false,
        retryCommand: 'jig review',
        agentRetryCommands: {
          codex: 'jig review --agent codex',
          claude: 'jig review --agent claude',
          pi: 'jig review --agent pi',
        },
      },
    ),
  ).toBe('')
})

test('explicit selection rendering preserves authored and effective clients', () => {
  const text = renderReviewAgentSelections(
    {
      ...blocked,
      selectedAcpUnavailable: false,
      issues: [],
      selections: [
        {
          binding: 'model',
          declaration: 'bindings/model.ts',
          slot: 'native',
          sourceClient: 'pi',
          effectiveClient: 'codex',
          source: issue.location,
        },
      ],
    },
    { agent: 'codex', details: false },
  )
  expect(text).toContain('source "pi" -> effective "codex"')
  expect(text).toContain('every selected ACP')
})

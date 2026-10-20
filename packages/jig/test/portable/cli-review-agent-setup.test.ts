import { describe, expect, test } from 'bun:test'
import { privateCliHumanText } from '../../src/cli-presentation.js'
import {
  renderReviewAgentSelections,
  renderReviewAgentSetup,
} from '../../src/cli-review-agent-setup.js'
import type {
  PrivateAgentReadinessIssue,
  PrivateAgentReadinessReport,
} from '../../src/internal/review-agent-setup.js'

function issue(overrides: Partial<PrivateAgentReadinessIssue> = {}): PrivateAgentReadinessIssue {
  return {
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
    alternatives: ['codex', 'claude', 'codex'],
    ...overrides,
  }
}
function report(issues = [issue()]): PrivateAgentReadinessReport {
  return {
    selectedAcpUnavailable: true,
    ...(issues[0] === undefined ? {} : { primaryIssue: issues[0] }),
    observedIssues: issues.length,
    observedPolicyGroups: issues.length,
    uncheckedResources: 0,
    complete: true,
    omittedPolicyGroups: 0,
    issues,
    selections: [],
    omittedSelections: 0,
  }
}
const options = {
  details: true,
  retryCommand: "jig review './project' --allow-resolution-network --verification strict",
  agentRetryCommands: {
    codex: "jig review './project' --agent codex --allow-resolution-network --verification strict",
    claude:
      "jig review './project' --agent claude --allow-resolution-network --verification strict",
    pi: "jig review './project' --agent pi --allow-resolution-network --verification strict",
  },
}

describe('concise review Agent recovery', () => {
  const compactOptions = { ...options, details: false }

  test('one missing client has a short cause, location and complete recovery commands', () => {
    const text = renderReviewAgentSetup(
      report([issue({ alternatives: ['codex'] })]),
      compactOptions,
    )
    expect(text).toBe(`Review could not finish

  Agent unavailable: Pi executable not found.
  Selection: "bindings/model.ts":5:33; slot "native".

  Next step
    Install Pi, add it to PATH, or set PI_PATH to its absolute executable path.
    $ ${options.retryCommand}

  Or use Codex
    Executable found; login and readiness not checked.
    $ ${options.agentRetryCommands.codex}
    All native Agent policies; source unchanged. Repeat --agent codex next review.

  Diagnostic code: PROJECT_ACP_PI_EXECUTABLE

  No new approval. Previous approval unchanged. No Flow or model call started.
  Setup details: add --details to your review command.
`)
    expect(text.split(/\s+/).length).toBeLessThan(140)
    expect(text).not.toContain('Affected direct recipients')
    expect(text).not.toContain('captured source client literal')
    expect(text).not.toContain('Shell aliases')
    expect(text).not.toContain('--yes')
    expect(text).not.toContain('--allow-authority-changes')
  })

  test('colour highlights the blocker and actions without changing plain or narrow output', () => {
    const text = renderReviewAgentSetup(
      report([issue({ alternatives: ['codex'] })]),
      compactOptions,
    )
    for (const columns of [undefined, 80, 32]) {
      const plain = privateCliHumanText(text, false, columns)
      const colored = privateCliHumanText(text, true, columns)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Compare styled terminal data with its plain fallback.
      expect(colored.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain)
      expect(colored).toContain('\u001b[1;31mReview could not finish')
      expect(colored).toContain('\u001b[1;33m  Agent unavailable:')
      expect(colored).toContain('\u001b[1m  Next step')
      expect(colored).toContain('\u001b[1m  Or use Codex')
      expect(colored).toContain('\u001b[90m  Selection:')
      expect(colored).toContain('\u001b[90m  Diagnostic code:')
      expect(plain).toContain(`$ ${options.agentRetryCommands.codex}`)
      expect(plain).not.toContain('\u001b')
    }
  })

  test('a rejected override needs repair without claiming the client is missing', () => {
    const text = renderReviewAgentSetup(
      report([issue({ rejectedOverride: 'PI_PATH' })]),
      compactOptions,
    )
    expect(text).toContain('PI_PATH was rejected. PATH was not used.')
    expect(text).toContain('Set PI_PATH to an absolute Pi executable, or unset it to use PATH.')
    expect(text).not.toContain('executable not found')
  })

  test('model pins, retention and non-executable causes do not suggest a client-switch command', () => {
    for (const value of [
      issue({ policy: { kind: 'acp', client: 'pi', model: 'chosen-model' } }),
      issue({ policy: { kind: 'acp', client: 'codex', retainSessions: true } }),
      issue({ code: 'PROJECT_ACP_PI_MODEL' }),
      issue({ alternatives: [] }),
    ]) {
      const text = renderReviewAgentSetup(report([value]), compactOptions)
      expect(text).toContain(options.retryCommand)
      expect(text).not.toContain('  Or use ')
      expect(text).not.toContain('Executable found;')
      expect(text).not.toContain(options.agentRetryCommands.codex)
    }
  })

  test('shared policies, effective overrides and uncertain source locations remain explicit', () => {
    const text = renderReviewAgentSetup(
      report([
        issue({
          source: 'named',
          location: { path: 'custom-policy/agent.json', kind: 'unlocated' },
          client: 'codex',
          sourceClient: 'pi',
          override: 'codex',
          code: 'PROJECT_ACP_CODEX_EXECUTABLE',
          alternatives: [],
        }),
      ]),
      compactOptions,
    )
    expect(text).toContain('Named policy (exact client line unknown): "custom-policy/agent.json"')
    expect(text).toContain('Client: "codex" from --agent codex; source: "pi"')
    expect(text).toContain('Affects: "binding:model"; slot "native"')
    const computed = renderReviewAgentSetup(
      report([
        issue({
          location: { path: 'bindings/model.ts', kind: 'selection-context' },
        }),
      ]),
      compactOptions,
    )
    expect(computed).toContain('Selection context: "bindings/model.ts"')
    expect(computed).not.toContain('change the source client value')
  })
})

describe('read-only review Agent setup diagnostics', () => {
  test('details retain provenance, passive alternatives, selected-client repair and one safe retry', () => {
    const text = renderReviewAgentSetup(report(), options)
    expect(text).toContain('Review could not finish')
    expect(text).toContain('Pi is selected, but no usable executable')
    expect(text).toContain('"bindings/model.ts":5:33; slot "native"')
    expect(text).toContain('captured source client literal')
    expect(text).toContain('binding:model')
    expect(text).toContain('authentication and readiness not checked')
    expect(text).toContain('To keep Pi:')
    expect(text).toContain('PI_PATH')
    expect(text).toContain('from "pi" to "codex"')
    expect(text).toContain('from "pi" to "claude"')
    expect(text.match(/\$ jig review/g)).toHaveLength(1)
    expect(text).toContain(options.retryCommand)
    expect(text).not.toContain('--yes')
    expect(text).not.toContain('--allow-authority-changes')
    expect(text).toContain('including code-only entrypoints')
    expect(text).toContain('add --agent claude or --agent codex on the retry below')
    expect(text).toContain('every selected ACP policy')
    expect(text).toContain('Repeat the option on later reviews')
    expect(text).toContain('All observed source policy facts')
    expect(text).toContain('No new approval was recorded. Any existing approval remains unchanged.')
    expect(text).toContain('No Flow or model call started.')
  })

  test('computed and missing coordinates give honest inspection guidance', () => {
    for (const kind of ['selection-context', 'unlocated'] as const) {
      const value = issue({ location: { path: 'bindings/model.ts', kind } })
      const text = renderReviewAgentSetup(report([value]), options)
      expect(text).not.toContain('change the source client value')
      expect(text).toContain('inspect the selected Binding slot expression')
      expect(text).toContain(
        kind === 'unlocated'
          ? 'No exact client line was located'
          : 'not a verified editable client literal',
      )
    }
  })

  test('named source policy lists recipients once and preserves conditional model and retention guidance', () => {
    const value = issue({
      source: 'named',
      location: { path: 'custom-policy/agent.json', line: 4, kind: 'client-literal' },
      client: 'codex',
      sourceClient: 'codex',
      code: 'PROJECT_ACP_CODEX_EXECUTABLE',
      policy: {
        kind: 'acp',
        client: 'codex',
        model: 'chosen-model',
        maxTurns: 4,
        retainSessions: true,
      },
      recipients: [
        { binding: 'model', declaration: 'bindings/model.ts', slot: 'native' },
        { binding: 'assistant', declaration: 'bindings/assistant.ts', slot: 'agent' },
      ],
      alternatives: ['claude', 'pi'],
      observedRefusals: 2,
    })
    const text = renderReviewAgentSetup({ ...report([value]), observedIssues: 2 }, options)
    expect(text).toContain('Named policy: "custom-policy/agent.json":4')
    expect(text.match(/Codex is selected/g)).toHaveLength(1)
    expect(text).toContain('binding:assistant')
    expect(text).toContain('This policy pins a model')
    expect(text).toContain('no model compatibility is inferred')
    expect(text).toContain('Keep Codex to retain it')
    expect(text).toContain('Preserve maxTurns: 4')
    expect(
      renderReviewAgentSetup(
        { ...report([value]), observedIssues: 2 },
        { ...options, details: true },
      ),
    ).toContain('2 selected ACP refusals across 1 source policy')
    expect(text).not.toContain('on the retry below')
    expect(renderReviewAgentSetup(report(), options)).not.toContain('model compatibility')
    expect(renderReviewAgentSetup(report(), options)).not.toContain(
      'This policy requests Codex session retention',
    )
  })

  test('non-executable causes never display alternative installations', () => {
    const text = renderReviewAgentSetup(report([issue({ code: 'PROJECT_ACP_PI_MODEL' })]), options)
    expect(text).toContain('model configuration is missing or invalid')
    expect(text).toContain('To keep Pi:')
    expect(text).not.toContain('Detected alternatives')
    expect(text).not.toContain('To use Codex')
  })

  test('zero alternatives retains repair and manual selection guidance without claiming no installation', () => {
    const text = renderReviewAgentSetup(report([issue({ alternatives: [] })]), options)
    expect(text).toContain('To keep Pi:')
    expect(text).toContain('no alternative executable was detected')
    expect(text).not.toContain('uninstalled')
    expect(text).not.toContain('Detected alternatives')
  })

  test('source literal is never attributed to the effective override client', () => {
    const value = issue({
      client: 'codex',
      sourceClient: 'pi',
      override: 'codex',
      policy: { kind: 'acp', client: 'codex' },
      code: 'PROJECT_ACP_CODEX_EXECUTABLE',
      alternatives: ['claude'],
    })
    const text = renderReviewAgentSetup(report([value]), options)
    expect(text).toContain('Source client: "pi"; effective client: "codex" from --agent codex')
    expect(text).toContain('from "pi" to "claude"; replace or omit the current --agent option too')
    expect(text).not.toContain('from "codex" to "claude"')
    expect(text).toContain('replace the current option with --agent claude on the retry below')
  })

  test('bounded rows cannot erase the primary blocker or uncompleted checks', () => {
    const primaryIssue = issue()
    const value = {
      ...report(),
      primaryIssue,
      issues: [],
      complete: false,
      observedPolicyGroups: 4,
      observedIssues: 5,
      omittedPolicyGroups: 4,
      uncheckedResources: 3,
    }
    const text = renderReviewAgentSetup(value, { ...options, details: true })
    expect(text).toContain('Pi is selected')
    expect(text).toContain('PROJECT_ACP_PI_EXECUTABLE')
    expect(text).toContain('4 observed source policy groups are omitted')
    expect(text).toContain('3 remaining selected ACP checks were not completed')
    expect(text).toContain('omitted facts cannot be recovered by --details')
    expect(text).toContain('no additional checks were performed')
    const later = issue({
      declaration: 'bindings/later.ts',
      location: { path: 'bindings/later.ts', kind: 'unlocated' },
    })
    expect(renderReviewAgentSetup({ ...value, issues: [later] }, options)).toContain(
      '"bindings/model.ts":5:33',
    )
    expect(renderReviewAgentSetup(undefined, options)).toBe('')
    expect(renderReviewAgentSetup({ ...report(), selectedAcpUnavailable: false }, options)).toBe('')
  })

  test('compact and details disclose known omissions and fit the terminal writer budget', () => {
    const value = issue({
      recipients: Array.from({ length: 4096 }, (_, i) => ({
        binding: `peer-${i}`,
        declaration: `bindings/${'long'.repeat(128)}.ts`,
        slot: 'native',
      })),
    })
    const compact = renderReviewAgentSetup(report([value]), { ...options, details: false })
    expect(compact).toContain('4093 known direct recipients are omitted')
    const detailed = renderReviewAgentSetup(report([value]), { ...options, details: true })
    expect(detailed).toContain('known direct recipients are omitted')
    expect(Buffer.byteLength(detailed)).toBeLessThan(131_072)
    expect(detailed).toContain('No new approval')
    expect(detailed).toContain(options.retryCommand)
  })

  test('literal source and recipient values stay escaped in plain, narrow and redirected presentation', () => {
    const value = issue({
      source: 'named',
      location: { path: 'bindings/emoji-😀\n\u001b[31m.ts', kind: 'unlocated' },
      recipients: [
        { binding: 'fake\nProject ready', declaration: 'fake\u001b[0m.ts', slot: 'native' },
      ],
    })
    for (const details of [false, true]) {
      const text = renderReviewAgentSetup(report([value]), { ...options, details })
      expect(text).not.toContain('\u001b')
      expect(text).not.toContain('😀')
      expect(text).toContain('\\ud83d\\ude00')
      expect(text).toContain('\\u000aProject ready')
      const plain = privateCliHumanText(text, false, 32)
      expect(plain).not.toContain('\u001b')
      expect(plain).toContain('PROJECT_ACP_PI_EXECUTABLE')
      expect(plain).toContain(`$ ${options.retryCommand}`)
    }
  })
})

describe('review-only client selection disclosure', () => {
  function selected(count = 1): PrivateAgentReadinessReport {
    return {
      ...report([]),
      selectedAcpUnavailable: false,
      selections: Array.from({ length: count }, (_, i) => ({
        binding: `model-${i}`,
        declaration: 'bindings/model.ts',
        slot: 'native',
        sourceClient: 'pi',
        effectiveClient: 'codex',
        source: { path: 'bindings/model.ts', line: 5, kind: 'client-literal' },
      })),
    }
  }
  test('explains global scope, source/effective clients, repeat review and persistent source preference', () => {
    const text = renderReviewAgentSelections(selected(), { agent: 'codex', details: false })
    expect(text).toContain('every selected ACP policy')
    expect(text).toContain('source "pi" -> effective "codex"')
    expect(text).toContain('"bindings/model.ts":5 (captured client literal)')
    expect(text).toContain('leaves source files unchanged')
    expect(text).toContain('HTTP-backed Agents and Flow routes are unaffected')
    expect(text).toContain('Repeat --agent codex')
    expect(text).toContain('edit the Binding or named ACP policy, then review without --agent')
    expect(text).toContain('normal exact approval still applies')
  })
  test('a known previous flag is explained on bare review without inventing current-source provenance', () => {
    const text = renderReviewAgentSelections(selected(), { previousAgent: 'codex', details: false })
    expect(text).toContain('previous approval used --agent codex')
    expect(text).toContain('earlier flag is not reused')
    expect(text).toContain('complete captured code and source-derived client policy together')
    expect(text).toContain('failed or declined review retains the earlier approved code and client')
    expect(renderReviewAgentSelections(selected(), { details: false })).toBe('')
  })
  test('both views retain exact known omission counts and a safe output bound', () => {
    const value = { ...selected(4096), omittedSelections: 9 }
    const text = renderReviewAgentSelections(value, { agent: 'codex', details: false })
    expect(text).toContain('4097 known selected ACP recipients are omitted')
    expect(text).toContain('report-limit omissions cannot be recovered by --details')
    const details = renderReviewAgentSelections(value, { agent: 'codex', details: true })
    expect(Buffer.byteLength(details)).toBeLessThan(131_072)
    expect(details).toContain('known selected ACP recipients are omitted')
    expect(details).toContain('Repeat --agent codex')
  })
})

test('known rejected override identifies the operator field without its private value', () => {
  const text = renderReviewAgentSetup(report([issue({ rejectedOverride: 'PI_PATH' })]), options)
  expect(text).toContain('PI_PATH was rejected')
  expect(text).toContain('Operator PATH was not used')
  expect(text).toContain('To keep Pi:')
})

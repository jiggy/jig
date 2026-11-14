import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  ProjectAdministrationError,
  type ProjectSession,
} from '../../src/administration/project.js'
import { RootAdministrationError, type RootRunTerminal } from '../../src/administration/root.js'
import { main, privateCliRunFailure, renderFailure } from '../../src/cli.js'
import { privateCliHumanText } from '../../src/cli-presentation.js'
import { CheckError } from '../../src/diagnostics.js'
import { projectError } from '../../src/internal/project-session-controller.js'
import type { PrivateAgentReadinessReport } from '../../src/internal/review-agent-setup.js'
import { parseInvocationContract } from '../../src/invocation-contract.js'
import { scopePackageDiagnostic } from '../../src/project/flow-source.js'
import { SchemaDiagnostic } from '../../src/schema/index.js'

const operationSecret =
  'SYNTHETIC_OPERATION_FAILURE /private/input Authorization=Bearer SYNTHETIC_TICKET'
const closeSecret = 'SYNTHETIC_CLOSE_FAILURE /private/host SYNTHETIC_RECOVERY_TICKET'
const recovery = 'https://jig.md/reference/troubleshooting#unconfirmed-cleanup'

for (const [origin, source] of [
  ['default', 'built-in default'],
  ['project', 'jig.ts limits.dependencies.maxPreparations'],
  ['environment', 'JIG_LIMITS_DEPENDENCIES_MAX_PREPARATIONS'],
] as const) {
  test(`preparation count refusal explains the ${origin} allowance without private details`, () => {
    const projected = projectError(
      new CheckError(
        'invalid',
        'PACKAGE_BUN_PROJECT_COUNT_LIMIT',
        operationSecret,
        'flows/item-16',
        undefined,
        undefined,
        undefined,
        { dimension: 'preparations', observed: 17, maximum: 16, origin },
      ),
      'plan',
    )
    const output: string[] = []
    expect(renderFailure(projected, { writeError: (text) => output.push(text) })).toBe(1)
    expect(output).toHaveLength(1)
    const text = output[0]!
    for (const expected of [
      'Review could not finish',
      'Location: "flows/item-16"',
      'Observed: at least 17 distinct dependency preparations',
      'Effective limit: 16',
      `Limit source: ${source}`,
      'limits.dependencies.maxPreparations in jig.ts',
      'JIG_LIMITS_DEPENDENCIES_MAX_PREPARATIONS',
      'integer between 1 and 256',
      'Exported environment values take precedence',
      'Aggregate byte and time limits still apply',
      'no additional network or Run authority',
      'No Flow was started by this review',
      'Rerun your review command after adjusting the allowance',
      'https://jig.md/reference/limits',
      'Diagnostic code: PACKAGE_BUN_PROJECT_COUNT_LIMIT',
      'Category: INVALID_CANDIDATE',
    ]) {
      expect(text).toContain(expected)
    }
    expect(text).not.toContain('maxPreparedFiles')
    expect(text).not.toContain('17 Flows')
    expect(text).not.toContain('SYNTHETIC_')
    expect(text).not.toContain('/private/')
    expect(text).not.toContain('\u001b')
    // This pure presentation check does not qualify preparation or host cleanup.
    for (const theme of ['one-dark', 'one-light', 'macchiato']) {
      const environment = { JIG_THEME: theme, TERM: 'xterm-256color' }
      for (const width of [40, 80]) {
        const plain = privateCliHumanText(text, false, width, environment)
        const styled = privateCliHumanText(text, true, width, environment)
        // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip actual SGR sequences from terminal acceptance output.
        expect(styled.replace(/\u001b\[[0-9;]*m/g, '')).toBe(plain)
        expect(styled).toContain('\u001b[1;31m')
        expect(plain.replace(/\s+/g, ' ')).toContain(
          'Observed: at least 17 distinct dependency preparations',
        )
        expect(plain).toContain('JIG_LIMITS_DEPENDENCIES_MAX_PREPARATIONS')
      }
    }
  })
}

test('preparation count refusal without numeric evidence does not invent observed values', () => {
  const projected = projectError(
    new CheckError('invalid', 'PACKAGE_BUN_PROJECT_COUNT_LIMIT', operationSecret, 'flows/overflow'),
    'plan',
  )
  const output: string[] = []
  expect(renderFailure(projected, { writeError: (text) => output.push(text) })).toBe(1)
  expect(output).toHaveLength(1)
  expect(output[0]).toContain('limits.dependencies.maxPreparations')
  expect(output[0]).toContain('integer between 1 and 256')
  expect(output[0]).not.toContain('Observed:')
  expect(output[0]).not.toContain('Effective limit:')
  expect(output[0]).not.toContain('Limit source:')
  expect(output[0]).not.toContain('SYNTHETIC_')
})

test('evaluation output refusal retains its fixed profile and omits count overrides', () => {
  const failure = new ProjectAdministrationError('INVALID_CANDIDATE', 'invalid', {
    code: 'PACKAGE_BUN_OUTPUT_LIMIT',
    path: 'recipes/evaluate',
    preparationLimit: {
      dimension: 'files',
      observed: 8193,
      maximum: 8192,
      profile: 'evaluation',
    },
  })
  const output: string[] = []
  expect(renderFailure(failure, { writeError: (text) => output.push(text) })).toBe(1)
  expect(output).toHaveLength(1)
  expect(output[0]).toContain('Observed: at least 8193 file/alias records')
  expect(output[0]).toContain('Effective limit: 8192')
  expect(output[0]).toContain('Limit source: fixed evaluation profile')
  expect(output[0]).toContain('Production dependency overrides do not apply to evaluation')
  expect(output[0]).not.toContain('maxPreparations')
  expect(output[0]).not.toContain('JIG_LIMITS_DEPENDENCIES')
})

for (const { code, pointer, guidance } of [
  {
    code: 'PROJECT_CHILD_BOUND_ATTACHMENTS_UNSUPPORTED',
    pointer: '/slots/child',
    guidance: ['child Binding without retained attachments', 'complete attachment map'],
  },
  {
    code: 'PROJECT_CHILD_ATTACHMENT_MAPPING_INVALID',
    pointer: '/slots/child/attachments',
    guidance: ['caller and child interfaces', 'compatible access', 'writable child attachment'],
  },
]) {
  test(`${code} renders its caller location and supported correction`, () => {
    const projected = projectError(
      new CheckError('invalid', code, operationSecret, 'bindings/parent.ts', pointer),
      'plan',
    )
    const output: string[] = []
    const exit = renderFailure(projected, { writeError: (text) => output.push(text) })
    expect(exit).toBe(1)
    expect(output).toHaveLength(1)
    const text = output[0]!
    expect(text).toContain('Review could not finish')
    expect(text).toContain('Location: "bindings/parent.ts"')
    expect(text).toContain(`Value: "${pointer}"`)
    expect(text).toContain(`Diagnostic code: ${code}`)
    expect(text).toContain('Category: INVALID_CANDIDATE')
    expect(text).toContain('No Flow was started by this review')
    for (const statement of guidance) expect(text).toContain(statement)
    expect(text).not.toContain('INTERNAL')
    expect(text).not.toContain('SYNTHETIC_')
    expect(text).not.toContain('/private/')
  })
}

for (const { name, keyword, renderedKeyword, renderedPointer } of [
  {
    name: 'pattern',
    keyword: 'pattern',
    renderedKeyword: '"pattern"',
    renderedPointer: '"/input/properties/id/pattern"',
  },
  {
    name: 'an escaped keyword',
    keyword: 'bad~1/keyword\u001b[31m\nnext',
    renderedKeyword: '"bad~1/keyword\\u001b[31m\\u000anext"',
    renderedPointer: '"/input/properties/id/bad~01~1keyword\\u001b[31m\\u000anext"',
  },
]) {
  test(`schema review identifies ${name} without rendering rejected values or controls`, () => {
    let unsupported: unknown
    try {
      parseInvocationContract(
        Buffer.from(
          JSON.stringify({
            $schema: 'https://flow.jig.md/schemas/invocation-contract-0.schema.json',
            input: {
              type: 'object',
              properties: { id: { type: 'string', [keyword]: operationSecret } },
            },
          }),
        ),
      )
    } catch (error) {
      unsupported = error
    }
    expect(unsupported).toBeInstanceOf(SchemaDiagnostic)
    const projected = projectError(scopePackageDiagnostic(unsupported, 'methods/probe'), 'plan')
    const output: string[] = []
    expect(renderFailure(projected, { writeError: (text) => output.push(text) })).toBe(1)
    expect(output).toHaveLength(1)
    const text = output[0]!
    expect(text).toContain(
      `The schema keyword ${renderedKeyword} is not supported by FLOW Schema/0.`,
    )
    expect(text).toContain('Location: "methods/probe/FLOW.contract.json"')
    expect(text).toContain(`Value: ${renderedPointer}`)
    expect(text).toContain('Diagnostic code: SCHEMA_KEYWORD_UNSUPPORTED')
    expect(text).toContain('Category: INVALID_CANDIDATE')
    expect(text).not.toContain(operationSecret)
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\nnext')
  })
}

type Failure = { failed: false } | { failed: true; value: unknown }
const success: Failure = { failed: false }
const failure = (value: unknown): Failure => ({ failed: true, value })

// This diagnostic probe does not acquire a native host or establish cleanup evidence.
async function review(
  operation: Failure,
  close: Failure,
  readiness?: PrivateAgentReadinessReport,
  relativeSelection = false,
) {
  const project = await mkdtemp(join(tmpdir(), 'jig-cli-session-failure-'))
  const invocationDirectory = relativeSelection ? dirname(project) : project
  const sourceRootOperand = `${basename(project)}-dependency`
  const events: string[] = []
  const output: string[] = []
  const errors: string[] = []
  let reportReadiness: ((report: PrivateAgentReadinessReport) => void) | undefined
  let acquiredProject: string | undefined
  let acquiredSourceRoots: readonly string[] | undefined
  const session: ProjectSession = {
    async plan() {
      events.push('plan')
      if (readiness !== undefined) reportReadiness?.(readiness)
      if (operation.failed) throw operation.value
      return { state: 'unchanged' }
    },
    async apply() {
      events.push('apply')
      throw new Error('The diagnostic probe must not apply a project plan')
    },
    get rootAdministration(): never {
      events.push('rootAdministration')
      throw new Error('The diagnostic probe must not start execution')
    },
    async close() {
      events.push('close')
      if (close.failed) throw close.value
    },
  }
  try {
    const exit = await main(
      [
        'review',
        ...(relativeSelection ? [basename(project), '--source-root', sourceRootOperand] : []),
        '--yes',
      ],
      {
        currentDirectory: invocationDirectory,
        interactive: false,
        terminalOutput: false,
        terminalError: false,
        writeOutput: (text) => output.push(text),
        writeError: (text) => errors.push(text),
        host: {
          async acquire(selectedProject, options) {
            events.push('acquire')
            acquiredProject = selectedProject
            acquiredSourceRoots = options?.sourceRoots
            reportReadiness = options?.onAgentReadiness
            return session
          },
        },
      },
    )
    expect(events).toEqual(['acquire', 'plan', 'close'])
    expect(acquiredProject).toBe(project)
    expect(acquiredSourceRoots).toEqual(
      relativeSelection ? [join(invocationDirectory, sourceRootOperand)] : undefined,
    )
    expect(await readdir(project)).toEqual([])
    const text = [...output, ...errors].join('')
    expect(text).not.toContain('SYNTHETIC_')
    expect(text).not.toContain('/private/')
    expect(text).not.toContain(project)
    return { exit, output, errors, text: errors.join('') }
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

test('interactive review asks for an unpinned Agent only when no explicit operand is given', async () => {
  const project = await mkdtemp(join(tmpdir(), 'jig-review-agent-choice-'))
  try {
    for (const options of [
      { args: ['review'], interactive: true, choice: 'pi', expected: 'pi' },
      { args: ['review', '--agent', 'claude'], interactive: true, choice: 'pi', expected: undefined },
      { args: ['review', '--yes'], interactive: true, choice: 'pi', expected: undefined },
    ] as const) {
      const prompts: string[] = []
      const selected: string[] = []
      let choose: (() => Promise<'codex' | 'claude' | 'pi' | undefined>) | undefined
      const session: ProjectSession = {
        async plan() {
          if (choose !== undefined) {
            const value = await choose()
            if (value !== undefined) selected.push(value)
          }
          return { state: 'unchanged' }
        },
        async apply() { throw new Error('unchanged review must not apply') },
        get rootAdministration(): never { throw new Error('review must not run') },
        async close() {},
      }
      const exit = await main(options.args, {
        currentDirectory: project,
        interactive: options.interactive,
        terminalOutput: false,
        terminalError: false,
        answer: async (prompt) => {
          prompts.push(prompt)
          return options.choice
        },
        writeOutput: () => {},
        writeError: () => {},
        host: {
          async acquire(_project, configuration) {
            choose = configuration?.onAgentSelection
            return session
          },
        },
      })
      expect(exit).toBe(0)
      expect(selected).toEqual(options.expected === undefined ? [] : [options.expected])
      expect(prompts.length).toBe(options.expected === undefined ? 0 : 1)
      expect(await readdir(project)).toEqual([])
    }
  } finally {
    await rm(project, { recursive: true, force: true })
  }
})

for (const operationFails of [false, true]) {
  for (const closeFails of [false, true]) {
    test(`review diagnostic phases with operation ${operationFails ? 'failed' : 'completed'} and close ${closeFails ? 'failed' : 'completed'}`, async () => {
      const result = await review(
        operationFails ? failure(new Error(operationSecret)) : success,
        closeFails ? failure(new Error(closeSecret)) : success,
        undefined,
        !operationFails && !closeFails,
      )
      expect(result.exit).toBe(operationFails || closeFails ? 2 : 0)
      if (!operationFails && !closeFails) {
        expect(result.output.join('')).toContain('Project ready')
        expect(result.errors).toEqual([])
        return
      }
      expect(result.output).toEqual([])
      expect(result.errors).toHaveLength(1)
      if (!closeFails) {
        expect(result.text).toContain('JIG_COMMAND_UNAVAILABLE')
        expect(result.text).not.toContain('JIG_CLEANUP_FAILED')
        return
      }
      expect(result.text).toContain('JIG_CLEANUP_FAILED')
      expect(result.text).toContain('Cleanup could not be confirmed')
      expect(result.text).toContain(
        operationFails ? 'Operation failure: UNCLASSIFIED' : 'Operation: completed',
      )
      expect(result.text).toContain('Close failure: UNCLASSIFIED')
      expect(result.text).toContain(recovery)
      expect(result.text).not.toContain('$ jig review')
      expect(result.text).not.toContain('$ jig run')
    })
  }
}

test('dual failure preserves known phase codes without offering the operation retry', async () => {
  const result = await review(
    failure(new ProjectAdministrationError('STALE_PLAN', operationSecret)),
    failure(new RootAdministrationError('PROJECT_CLOSED', closeSecret)),
  )
  expect(result.exit).toBe(2)
  expect(result.output).toEqual([])
  expect(result.errors).toHaveLength(1)
  expect(result.text).toContain('JIG_CLEANUP_FAILED')
  expect(result.text).toContain('Operation failure: STALE_PLAN')
  expect(result.text).toContain('Close failure: PROJECT_CLOSED')
  expect(result.text).toContain('Cleanup could not be confirmed')
  expect(result.text).toContain(recovery)
  expect(result.text).not.toContain('$ jig review')
  expect(result.text).not.toContain('$ jig run')
})

test('successful close preserves the ordinary known operation diagnostic', async () => {
  const result = await review(
    failure(new ProjectAdministrationError('STALE_PLAN', operationSecret)),
    success,
  )
  expect(result.exit).toBe(1)
  expect(result.output).toEqual([])
  expect(result.text).toContain('STALE_PLAN')
  expect(result.text).toContain('$ jig review')
  expect(result.text).not.toContain('JIG_CLEANUP_FAILED')
})

for (const scenario of [
  { name: 'primitive values', operation: operationSecret, close: closeSecret },
  { name: 'undefined and null', operation: undefined, close: null },
  {
    name: 'objects that imitate error types',
    operation: { name: 'ProjectAdministrationError', code: 'STALE_PLAN', message: operationSecret },
    close: { name: 'RootAdministrationError', code: 'PROJECT_CLOSED', message: closeSecret },
  },
]) {
  test(`dual failure keeps ${scenario.name} unclassified`, async () => {
    const result = await review(failure(scenario.operation), failure(scenario.close))
    expect(result.exit).toBe(2)
    expect(result.output).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.text).toContain('Operation failure: UNCLASSIFIED')
    expect(result.text).toContain('Close failure: UNCLASSIFIED')
    expect(result.text).not.toContain('STALE_PLAN')
    expect(result.text).not.toContain('PROJECT_CLOSED')
  })
}

test('unrecognized codes on known error classes remain private', async () => {
  const operation = new ProjectAdministrationError('STALE_PLAN', operationSecret)
  const close = new RootAdministrationError('PROJECT_CLOSED', closeSecret)
  Object.defineProperty(operation, 'code', { value: operationSecret })
  Object.defineProperty(close, 'code', { value: closeSecret })
  const result = await review(failure(operation), failure(close))
  expect(result.exit).toBe(2)
  expect(result.errors).toHaveLength(1)
  expect(result.text).toContain('Operation failure: UNCLASSIFIED')
  expect(result.text).toContain('Close failure: UNCLASSIFIED')
})

test('an unrelated aggregate cannot impersonate the command and close failure marker', async () => {
  const result = await review(
    failure(
      new AggregateError(
        [new ProjectAdministrationError('STALE_PLAN', operationSecret), new Error(closeSecret)],
        'project command and close both failed',
      ),
    ),
    success,
  )
  expect(result.exit).toBe(2)
  expect(result.output).toEqual([])
  expect(result.text).toContain('JIG_COMMAND_UNAVAILABLE')
  expect(result.text).not.toContain('STALE_PLAN')
  expect(result.text).not.toContain('JIG_CLEANUP_FAILED')
  expect(result.text).not.toContain('$ jig review')
})

const blockedAgent: PrivateAgentReadinessReport = {
  selectedAcpUnavailable: true,
  primaryIssue: {
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
  },
  observedIssues: 1,
  observedPolicyGroups: 1,
  uncheckedResources: 0,
  complete: false,
  omittedPolicyGroups: 1,
  issues: [],
  selections: [],
  omittedSelections: 0,
}

for (const closeFails of [false, true]) {
  test(`review setup guidance waits for ${closeFails ? 'failed' : 'successful'} close`, async () => {
    const result = await review(
      success,
      closeFails ? failure(new Error(closeSecret)) : success,
      blockedAgent,
    )
    expect(result.exit).toBe(2)
    expect(result.output).toEqual([])
    expect(result.errors).toHaveLength(1)
    if (closeFails) {
      expect(result.text).toContain('Operation failure: UNAVAILABLE')
      expect(result.text).toContain('Close failure: UNCLASSIFIED')
      expect(result.text).toContain('Cleanup could not be confirmed')
      expect(result.text).toContain(recovery)
      expect(result.text).not.toContain('$ jig review')
      expect(result.text).not.toContain('Pi executable not found')
    } else {
      expect(result.text).toContain('Pi executable not found')
      expect(result.text).not.toContain('$ jig review --agent codex')
      expect(result.text).toContain('$ jig review')
      expect(result.text).not.toContain('JIG_CLEANUP_FAILED')
    }
  })
}

const failedTerminals: Extract<RootRunTerminal, { status: 'failed' }>[] = [
  {
    status: 'failed',
    code: 'REVIEW_REQUIRED',
    message: 'The selected execution environment changed.',
    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
  },
  {
    status: 'failed',
    code: 'UNAVAILABLE',
    message: 'The selected target is unavailable.',
    details: {
      code: 'RUN_TARGET_UNAVAILABLE',
      availability: { cause: { diagnostic: 'PROJECT_ACP_PI_EXECUTABLE' } },
    },
    diagnostics: { stderr: '', stderrBytes: 0, stderrTruncated: false },
  },
]

for (const terminal of failedTerminals) {
  test(`${terminal.code} terminal guidance respects unconfirmed cleanup`, () => {
    const before = structuredClone(terminal)
    const target = { kind: 'binding' as const, id: 'probe' }
    const ordinary = privateCliRunFailure(terminal, target, false, false)
    expect(ordinary).toContain('$ jig review')
    const unresolved = privateCliRunFailure(terminal, target, false, false, true)
    expect(unresolved).toContain(terminal.code)
    expect(unresolved).toContain(terminal.message)
    expect(unresolved).toContain(recovery)
    expect(unresolved).not.toContain('$ jig review')
    expect(unresolved).not.toContain('$ jig run')
    expect(unresolved).not.toContain('review again')
    expect(unresolved).not.toContain('running this target again')
    expect(terminal).toEqual(before)
  })
}

test('phase classification does not evaluate error code accessors', async () => {
  const operation = new ProjectAdministrationError('STALE_PLAN', operationSecret)
  const close = new RootAdministrationError('PROJECT_CLOSED', closeSecret)
  let accesses = 0
  for (const error of [operation, close]) {
    Object.defineProperty(error, 'code', {
      get() {
        accesses++
        throw new Error(operationSecret)
      },
    })
  }
  const result = await review(failure(operation), failure(close))
  expect(result.exit).toBe(2)
  expect(result.errors).toHaveLength(1)
  expect(result.text).toContain('Operation failure: UNCLASSIFIED')
  expect(result.text).toContain('Close failure: UNCLASSIFIED')
  expect(accesses).toBe(0)
})

test('revoked proxies cannot prevent the cleanup uncertainty diagnostic', async () => {
  const operation = Proxy.revocable({}, {})
  const close = Proxy.revocable({}, {})
  operation.revoke()
  close.revoke()
  const result = await review(failure(operation.proxy), failure(close.proxy))
  expect(result.exit).toBe(2)
  expect(result.errors).toHaveLength(1)
  expect(result.text).toContain('Operation failure: UNCLASSIFIED')
  expect(result.text).toContain('Close failure: UNCLASSIFIED')
  expect(result.text).toContain(recovery)
})

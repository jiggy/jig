import { asciiJsonString } from './cli-usage.js'
import { ACP_SETUP_CAUSES, ACP_SETUP_HINTS } from './internal/acp-setup-diagnostics.js'
import type {
  PrivateAgentReadinessIssue,
  PrivateAgentReadinessReport,
} from './internal/review-agent-setup.js'
import type { AcpGrant } from './project/grants.js'

const CLIENT_NAMES = { codex: 'Codex', claude: 'Claude Code', pi: 'Pi' } as const
const CLIENT_PATHS = { codex: 'CODEX_PATH', claude: 'CLAUDE_PATH', pi: 'PI_PATH' } as const
const RENDER_BYTES = 131_072

interface SetupPresentation {
  readonly details: boolean
  readonly retryCommand: string
  readonly agentRetryCommands: Readonly<Record<AcpGrant['client'], string>>
}

/** Read-only human facts; the CLI supplies an already shell-quoted manual retry command. */
export function renderReviewAgentSetup(
  report: PrivateAgentReadinessReport | undefined,
  options: SetupPresentation,
): string {
  if (report === undefined || !report.selectedAcpUnavailable) return ''
  const issueLimit = options.details ? report.issues.length : 3
  const recipientLimit = options.details ? Number.POSITIVE_INFINITY : 3
  const candidates = [...report.issues]
  if (
    report.primaryIssue !== undefined &&
    !candidates.some(
      (issue) =>
        issue.location.path === report.primaryIssue!.location.path &&
        issue.declaration === report.primaryIssue!.declaration &&
        issue.slot === report.primaryIssue!.slot &&
        issue.code === report.primaryIssue!.code,
    )
  )
    candidates.unshift(report.primaryIssue)
  const rendered: string[] = []
  let omittedGroups = report.omittedPolicyGroups
  let bytes = 0
  for (const [index, issue] of candidates.entries()) {
    // Always preserve the primary cause, even if every bounded group was discarded.
    if (index >= issueLimit && rendered.length > 0) {
      omittedGroups++
      continue
    }
    const budget = RENDER_BYTES - bytes - 16_384
    const block = options.details
      ? renderIssue(issue, recipientLimit, budget)
      : renderCompactIssue(issue, options, recipientLimit, budget)
    if (rendered.length > 0 && bytes + Buffer.byteLength(block) > RENDER_BYTES - 16_384) {
      omittedGroups++
      continue
    }
    rendered.push(block)
    bytes += Buffer.byteLength(block)
  }
  if (rendered.length === 0 && report.primaryIssue !== undefined)
    rendered.push(
      options.details
        ? renderIssue(report.primaryIssue, 0, RENDER_BYTES - 16_384)
        : renderCompactIssue(report.primaryIssue, options, 0, RENDER_BYTES - 16_384),
    )
  const limits = [
    ...(options.details
      ? [
          `  Observed: ${report.observedIssues} selected ACP refusal${report.observedIssues === 1 ? '' : 's'} across ${report.observedPolicyGroups} source polic${report.observedPolicyGroups === 1 ? 'y' : 'ies'}.`,
        ]
      : []),
    ...(omittedGroups === 0
      ? []
      : [
          `  ${omittedGroups} observed source policy group${omittedGroups === 1 ? ' is' : 's are'} omitted from full detail in this view; the primary cause remains shown.`,
        ]),
    ...(report.omittedSelections === 0
      ? []
      : [
          `  ${report.omittedSelections} selected ACP recipient fact${report.omittedSelections === 1 ? ' was' : 's were'} omitted from the bounded report.`,
        ]),
    ...(report.complete
      ? options.details
        ? ['  All observed source policy facts were retained within the report limit.']
        : []
      : [
          '  The bounded observed report is incomplete; omitted facts cannot be recovered by --details.',
        ]),
    ...(report.uncheckedResources === 0
      ? []
      : [
          `  ${report.uncheckedResources} remaining selected ACP check${report.uncheckedResources === 1 ? ' was' : 's were'} not completed.`,
        ]),
    ...(options.details || report.uncheckedResources > 0
      ? [
          '  Qualification stops at the first failing ACP slot per target. A later review can expose another prerequisite.',
        ]
      : []),
    ...(options.details
      ? ['  Details show retained observed facts; no additional checks were performed.']
      : omittedGroups > 0 || candidates.some((issue) => issue.recipients.length > recipientLimit)
        ? ['  Use --details with the same review options to show more retained observed facts.']
        : []),
  ]
  if (options.details)
    return `Review could not finish\n\n${rendered.length === 0 ? '  A selected Agent prerequisite is unavailable. Its detailed source context was not retained.\n' : rendered.join('\n')}\n  After correcting the selected installation or policy, review again:\n\n  $ ${options.retryCommand}\n\n${limits.length === 0 ? '' : `${limits.join('\n')}\n\n`}  Locations refer to captured source; the next review checks your edits afresh.\n  This prerequisite stops project review, including code-only entrypoints.\n  No new approval was recorded. Any existing approval remains unchanged.\n  No Flow or model call started.\n`
  const fallback = `  A selected Agent prerequisite is unavailable.\n\n  Next step\n    $ ${options.retryCommand}\n`
  return `Review could not finish\n\n${rendered.length === 0 ? fallback : rendered.join('\n')}\n${limits.length === 0 ? '' : `${limits.join('\n')}\n\n`}  No new approval. Previous approval unchanged. No Flow or model call started.\n  Setup details: add --details to your review command.\n`
}

function renderCompactIssue(
  issue: PrivateAgentReadinessIssue,
  options: SetupPresentation,
  recipientLimit: number,
  byteBudget: number,
): string {
  const name = CLIENT_NAMES[issue.client]
  const executable = issue.code === `PROJECT_ACP_${issue.client.toUpperCase()}_EXECUTABLE`
  let cause = ACP_SETUP_CAUSES[issue.code] ?? 'The selected Agent configuration is unavailable.'
  let repair =
    ACP_SETUP_HINTS[issue.code]?.replace(
      / Then retry jig review\. No Flow was started by this review\.$/,
      '',
    ) ?? 'Check the selected Agent configuration.'
  if (executable) {
    cause = `${name} executable not found.`
    repair = `Install ${name}, add it to PATH, or set ${CLIENT_PATHS[issue.client]} to its absolute executable path.`
  }
  if (issue.rejectedOverride !== undefined) {
    cause = `${issue.rejectedOverride} was rejected. PATH was not used.`
    repair = `Set ${issue.rejectedOverride} to an absolute ${name} executable, or unset it to use PATH.`
  }
  const location = issue.location
  let coordinate = ''
  if (location.line !== undefined) {
    coordinate = `:${location.line}`
    if (location.column !== undefined) coordinate += `:${location.column}`
  }
  let label = issue.source === 'named' ? 'Named policy' : 'Selection'
  if (location.kind === 'selection-context') label = 'Selection context'
  if (location.kind === 'unlocated') label += ' (exact client line unknown)'
  const lines = [
    `  Agent unavailable: ${cause}`,
    `  ${label}: ${asciiJsonString(location.path)}${coordinate}; slot ${asciiJsonString(issue.slot)}.`,
  ]
  if (issue.override !== undefined)
    lines.push(
      `  Client: ${asciiJsonString(issue.client)} from --agent ${issue.override}; source: ${asciiJsonString(issue.sourceClient)}.`,
    )
  // Inline source already identifies its Binding. Shared policies need their recipients too.
  let omitted = issue.omittedRecipients
  let retained = 0
  let bytes = Buffer.byteLength(lines.join('\n'))
  for (const recipient of issue.recipients) {
    const row = `  Affects: ${asciiJsonString(`binding:${recipient.binding}`)}; slot ${asciiJsonString(recipient.slot)}.`
    if (retained >= recipientLimit || bytes + Buffer.byteLength(row) > byteBudget - 8192) {
      omitted++
      continue
    }
    if (issue.source === 'named' || issue.recipients.length > 1) lines.push(row)
    retained++
    bytes += Buffer.byteLength(row) + 1
  }
  if (omitted > 0)
    lines.push(
      `  ${omitted} known direct recipient${omitted === 1 ? ' is' : 's are'} omitted from this view.`,
    )
  lines.push('', '  Next step', `    ${repair}`, `    $ ${options.retryCommand}`)
  if (executable) {
    if (issue.policy.model !== undefined)
      lines.push('    This policy pins a model. Edit the policy before switching clients.')
    if (issue.policy.retainSessions === true)
      lines.push(
        '    This policy requests Codex session retention. Edit it before switching clients.',
      )
    const canSwitch = issue.policy.model === undefined && issue.policy.retainSessions !== true
    if (canSwitch) {
      for (const client of executableAlternatives(issue)) {
        lines.push(
          '',
          `  Or use ${CLIENT_NAMES[client]}`,
          '    Executable found; login and readiness not checked.',
          `    $ ${options.agentRetryCommands[client]}`,
          `    All native Agent policies; source unchanged. Repeat --agent ${client} next review.`,
        )
      }
    }
  }
  lines.push('', `  Diagnostic code: ${issue.code}`)
  return `${lines.join('\n')}\n`
}

function executableAlternatives(issue: PrivateAgentReadinessIssue): AcpGrant['client'][] {
  return [...new Set(issue.alternatives)]
    .filter((client) => client !== issue.client && Object.hasOwn(CLIENT_NAMES, client))
    .sort()
}

/** Source versus effective client is visible before consent, including unchanged reviews. */
export function renderReviewAgentSelections(
  report: PrivateAgentReadinessReport | undefined,
  options: {
    readonly agent?: AcpGrant['client']
    readonly previousAgent?: AcpGrant['client']
    readonly details: boolean
  },
): string {
  if (report === undefined || (options.agent === undefined && options.previousAgent === undefined))
    return ''
  const lines = [
    'ACP runtimes selected',
    '',
    ...(options.agent === undefined
      ? [
          `  The previous approval used --agent ${options.previousAgent}. This review uses the clients in captured source; the earlier flag is not reused.`,
        ]
      : [
          `  --agent ${options.agent} proposes ${CLIENT_NAMES[options.agent]} for every selected ACP policy in this review.`,
          '  This client selection leaves source files unchanged. HTTP-backed Agents and Flow routes are unaffected.',
        ]),
    '  Captured source and effective clients:',
  ]
  let bytes = Buffer.byteLength(lines.join('\n'))
  let shown = 0
  let omitted = report.omittedSelections
  for (const selection of report.selections) {
    const source = selection.source
    const coordinate =
      source.line === undefined
        ? ''
        : `:${source.line}${source.column === undefined ? '' : `:${source.column}`}`
    const line = `    ${asciiJsonString(`binding:${selection.binding}`)}; slot ${asciiJsonString(selection.slot)}; source ${asciiJsonString(selection.sourceClient)} -> effective ${asciiJsonString(selection.effectiveClient)}; ${asciiJsonString(source.path)}${coordinate} (${source.kind === 'client-literal' ? 'captured client literal' : source.kind === 'selection-context' ? 'selection context, not a client literal' : 'no exact client line located'}).`
    if (
      (!options.details && shown >= 8) ||
      bytes + Buffer.byteLength(line) > RENDER_BYTES - 16_384
    ) {
      omitted++
      continue
    }
    lines.push(line)
    bytes += Buffer.byteLength(line) + 1
    shown++
  }
  if (omitted > 0)
    lines.push(
      `  ${omitted} known selected ACP recipient${omitted === 1 ? ' is' : 's are'} omitted from this view${report.omittedSelections > 0 ? '; report-limit omissions cannot be recovered by --details' : options.details ? ' within the output limit' : '; --details shows more retained facts'}.`,
    )
  if (shown === 0 && omitted === 0) lines.push('  No selected ACP recipient facts were retained.')
  lines.push(
    '',
    ...(options.agent === undefined
      ? [
          '  Approving this review approves its complete captured code and source-derived client policy together. A failed or declined review retains the earlier approved code and client.',
        ]
      : [
          `  A later review starts from its captured source again. Repeat --agent ${options.agent} to propose this client again.`,
          '  For a durable project preference, edit the Binding or named ACP policy, then review without --agent.',
        ]),
    '  Client selection does not grant execution or dependency-network permission; normal exact approval still applies.',
    '',
  )
  return lines.join('\n')
}

function renderIssue(
  issue: PrivateAgentReadinessIssue,
  recipientLimit: number,
  byteBudget: number,
): string {
  const location = issue.location
  const coordinate =
    location.line === undefined
      ? ''
      : `:${location.line}${location.column === undefined ? '' : `:${location.column}`}`
  const lines = [
    `  ${issue.rejectedOverride === undefined ? (ACP_SETUP_CAUSES[issue.code] ?? 'The selected Agent configuration is unavailable.') : `${CLIENT_NAMES[issue.client]} is selected, but ${issue.rejectedOverride} was rejected: it did not select a usable executable. Operator PATH was not used.`}`,
    `  ${issue.source === 'named' ? 'Named policy' : 'Selection'}: ${asciiJsonString(location.path)}${coordinate}; slot ${asciiJsonString(issue.slot)}.`,
    ...(location.kind === 'unlocated'
      ? ['  No exact client line was located; inspect this captured file and its selected slot.']
      : location.kind === 'selection-context'
        ? ['  This is selection context, not a verified editable client literal.']
        : ['  This location identifies the captured source client literal.']),
    ...(issue.override === undefined
      ? [`  Selected client: ${asciiJsonString(issue.client)}.`]
      : [
          `  Source client: ${asciiJsonString(issue.sourceClient)}; effective client: ${asciiJsonString(issue.client)} from --agent ${issue.override}.`,
        ]),
  ]
  let omittedRecipients = issue.omittedRecipients
  let bytes = Buffer.byteLength(lines.join('\n'))
  let retainedRecipients = 0
  for (const recipient of issue.recipients) {
    const line = `    ${asciiJsonString(`binding:${recipient.binding}`)}; ${asciiJsonString(recipient.declaration)}; slot ${asciiJsonString(recipient.slot)}.`
    if (
      retainedRecipients >= recipientLimit ||
      bytes + Buffer.byteLength(line) > byteBudget - 4096
    ) {
      omittedRecipients++
      continue
    }
    if (retainedRecipients++ === 0) lines.push('  Affected direct recipients:')
    lines.push(line)
    bytes += Buffer.byteLength(line) + 1
  }
  if (omittedRecipients > 0)
    lines.push(
      `  ${omittedRecipients} known direct recipient${omittedRecipients === 1 ? ' is' : 's are'} omitted from this view.`,
    )
  const executable = issue.code === `PROJECT_ACP_${issue.client.toUpperCase()}_EXECUTABLE`
  const alternatives = executable ? executableAlternatives(issue) : []
  if (alternatives.length > 0)
    lines.push(
      `  Detected alternatives: ${alternatives.map((client) => asciiJsonString(client)).join(', ')} (executables found; authentication and readiness not checked).`,
    )
  const repair = ACP_SETUP_HINTS[issue.code]?.replace(
    / Then retry jig review\. No Flow was started by this review\.$/,
    '',
  )
  lines.push(
    `  To keep ${CLIENT_NAMES[issue.client]}: ${repair ?? 'Correct the selected ACP configuration and inspect the installed client prerequisites.'}`,
  )
  if (executable) {
    if (alternatives.length === 0)
      lines.push(
        '  To select another supported client, inspect and edit this ACP policy; no alternative executable was detected.',
      )
    for (const client of alternatives) {
      const action =
        location.kind === 'client-literal'
          ? `change the source client value from ${asciiJsonString(issue.sourceClient)} to ${asciiJsonString(client)}`
          : `inspect the selected ${issue.source === 'named' ? 'JSON policy' : 'Binding slot expression'} and change its ACP client to ${asciiJsonString(client)}`
      lines.push(
        `  To use ${CLIENT_NAMES[client]}, ${action}${issue.override === undefined ? '.' : '; replace or omit the current --agent option too.'}`,
      )
    }
    if (
      alternatives.length > 0 &&
      issue.policy.model === undefined &&
      issue.policy.retainSessions !== true
    )
      lines.push(
        `  To try another client without editing source, ${issue.override === undefined ? 'add' : 'replace the current option with'} ${alternatives.map((client) => `--agent ${client}`).join(' or ')} on the retry below.`,
        '  This proposes that client for every selected ACP policy; other model pins or session requirements can refuse it. Repeat the option on later reviews.',
      )
    if (issue.policy.model !== undefined)
      lines.push(
        '  This policy pins a model. For a different client, explicitly choose its model or remove the pin in source; no model compatibility is inferred.',
      )
    if (issue.policy.retainSessions === true)
      lines.push(
        '  This policy requests Codex session retention. Keep Codex to retain it; another client requires an explicit retention policy change.',
      )
    if (issue.policy.maxTurns !== undefined)
      lines.push(`  Preserve maxTurns: ${issue.policy.maxTurns} when editing the client selection.`)
  }
  lines.push(`  Diagnostic code: ${issue.code}`)
  return `${lines.join('\n')}\n`
}

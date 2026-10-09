import { createHash } from 'node:crypto'
import { ACP_SETUP_CAUSES, ACP_SETUP_HINTS } from './internal/acp-setup-diagnostics.js'
import type { PrivateAgentReadinessReport } from './internal/review-agent-setup.js'
import type { PrivateReviewGrantEdit } from './internal/review-grant-edit.js'
import { type AcpGrant, normalizeGrant } from './project/grants.js'

export interface PrivateReviewAgentInteraction {
  readonly interactive: boolean
  readonly yes: boolean
  readonly signal?: AbortSignal
  write(text: string): void
  answer(question: string, signal?: AbortSignal): Promise<string>
  confirm(question: string, signal?: AbortSignal): Promise<boolean>
}

export type PrivateReviewAgentAction =
  | { readonly kind: 'keep' | 'cancel' }
  | { readonly kind: 'edit'; readonly proposal: PrivateReviewGrantEdit }

/** Review proposes visible source; neither this interaction nor its write admits execution. */
export async function guidedReviewAgentSetup(
  report: PrivateAgentReadinessReport | undefined,
  interaction: PrivateReviewAgentInteraction,
  seen = new Set<string>(),
): Promise<PrivateReviewAgentAction> {
  if (report === undefined) return { kind: 'keep' }
  if (!report.complete) {
    interaction.write(
      'Agent setup exceeds the guided editing limit. Review the unavailable routes and edit their ACP grants directly; no source was changed.\n',
    )
    return { kind: 'keep' }
  }
  if (report.issues.length === 0) return { kind: 'keep' }
  for (const issue of report.issues) {
    const grant = issue.grant
    const key = JSON.stringify([
      grant?.path ?? issue.declaration,
      grant === undefined ? issue.slot : null,
      issue.code,
      issue.client,
      grant === undefined ? null : createHash('sha256').update(grant.bytes).digest('hex'),
    ])
    if (seen.has(key)) continue
    seen.add(key)
    interaction.signal?.throwIfAborted()
    interaction.write(
      `\nAgent setup\n\n  ${ACP_SETUP_CAUSES[issue.code] ?? 'The selected Agent configuration is unavailable.'}\n  Location: ${literal(issue.declaration)}; slot ${literal(issue.slot)}.\n`,
    )
    const alternatives = [...new Set(issue.alternatives)]
      .filter((client) => client !== issue.client && ['codex', 'claude', 'pi'].includes(client))
      .sort()
    if (
      !interaction.interactive ||
      interaction.yes ||
      grant === undefined ||
      issue.code !== `PROJECT_ACP_${issue.client.toUpperCase()}_EXECUTABLE` ||
      alternatives.length === 0
    ) {
      interaction.write(
        `  ${ACP_SETUP_HINTS[issue.code] ?? 'Correct the selected ACP configuration before reviewing again.'}\n${grant === undefined ? `  Edit the ACP grant selected by this Binding slot; inline TypeScript is not changed automatically.\n` : `  Selected grant: ${literal(grant.path)}. Edit its client/model policy directly if needed.\n`}  Affected routes remain unavailable; unrelated ready routes can still be reviewed.\n`,
      )
      continue
    }
    interaction.write(
      `  Selected grant: ${literal(grant.path)}.\n  Alternative installations are detected, but authentication and runtime readiness still need qualification.\n\n${alternatives.map((client, index) => `  ${index + 1}. Use ${client} — update ${literal(grant.path)} for all recipients listed below.\n`).join('')}  ${alternatives.length + 1}. Keep ${issue.client}; affected routes remain unavailable.\n  ${alternatives.length + 2}. Cancel review.\n\n`,
    )
    const selected = await choose(
      interaction,
      'Choice (empty keeps the current grant): ',
      alternatives.length + 2,
    )
    if (selected === 0 || selected === alternatives.length + 1) continue
    if (selected === alternatives.length + 2) return { kind: 'cancel' }
    const client = alternatives[selected - 1]!
    let model = grant.policy.model
    if (model !== undefined) {
      interaction.write(
        `\n  The current model pin ${literal(model)} belongs to the previous selection.\n  1. Use the new client's operator configuration/default.\n  2. Enter a replacement model pin.\n  3. Keep the original grant.\n\n`,
      )
      const treatment = await choose(interaction, 'Model choice (empty keeps the grant): ', 3)
      if (treatment === 0 || treatment === 3) continue
      if (treatment === 1) model = undefined
      else {
        model = (
          await interaction.answer(
            'Replacement model (empty keeps the grant): ',
            interaction.signal,
          )
        ).trim()
        interaction.signal?.throwIfAborted()
        if (model === '') continue
        try {
          normalizeGrant({ kind: 'acp', client, model })
        } catch {
          interaction.write('  The model identifier is invalid. The grant was not changed.\n')
          continue
        }
      }
    }
    let retainSessions = grant.policy.retainSessions
    if (retainSessions === true && client !== 'codex') {
      const remove = await interaction.confirm(
        'The new client cannot retain Codex sessions. Remove retainSessions from the proposed grant? [y/N] ',
        interaction.signal,
      )
      interaction.signal?.throwIfAborted()
      if (!remove) continue
      retainSessions = undefined
    }
    const proposed: AcpGrant = Object.freeze({
      kind: 'acp',
      client,
      ...(model === undefined ? {} : { model }),
      ...(grant.policy.maxTurns === undefined ? {} : { maxTurns: grant.policy.maxTurns }),
      ...(retainSessions === undefined ? {} : { retainSessions }),
    })
    interaction.write(
      `\nProposed source change\n\n  File: ${literal(grant.path)}\n  Client: ${literal(grant.policy.client)} -> ${literal(proposed.client)}\n  Model pin: ${grant.policy.model === undefined ? '(none)' : literal(grant.policy.model)} -> ${proposed.model === undefined ? '(none; operator configuration/default)' : literal(proposed.model)}\n  maxTurns: ${proposed.maxTurns === undefined ? '(default; unchanged)' : String(proposed.maxTurns)}\n  retainSessions: ${grant.policy.retainSessions === true ? 'true' : '(absent)'} -> ${proposed.retainSessions === true ? 'true' : '(absent)'}\n\n  All direct recipients of this named grant:\n${grant.recipients.map((recipient) => `    ${literal(`binding:${recipient.binding}`)}; ${literal(recipient.declaration)}; slot ${literal(recipient.slot)}\n`).join('')}\n  A fresh capture and separate execution approval follow this source write.\n`,
    )
    const consent = await interaction.confirm(
      `Update ${literal(grant.path)} with this proposed policy? [y/N] `,
      interaction.signal,
    )
    interaction.signal?.throwIfAborted()
    if (!consent) continue
    return {
      kind: 'edit',
      proposal: {
        path: grant.path,
        expectedBytes: Uint8Array.from(grant.bytes),
        projectIdentity: { ...report.projectIdentity },
        previous: grant.policy,
        proposed,
      },
    }
  }
  return { kind: 'keep' }
}

async function choose(
  interaction: PrivateReviewAgentInteraction,
  prompt: string,
  maximum: number,
): Promise<number> {
  const value = (await interaction.answer(prompt, interaction.signal)).trim()
  interaction.signal?.throwIfAborted()
  if (value === '') return 0
  if (/^[1-9][0-9]*$/.test(value) && Number(value) <= maximum) return Number(value)
  interaction.write('  No listed choice was selected. The original grant is retained.\n')
  return 0
}

/** Literal source/recipient values cannot introduce terminal controls or host prose. */
function literal(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

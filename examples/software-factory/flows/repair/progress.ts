import type { Evaluation } from './evidence.ts'

export const repairPhases = [
  'baseline',
  'proposal',
  'check',
  'finished',
  'command',
  'observed',
  'rejected',
] as const
export type RepairPhase = (typeof repairPhases)[number]
export const repairProgressSchema = {
  type: 'object',
  properties: {
    phase: { type: 'string', enum: repairPhases },
    attempt: { type: 'integer', minimum: 0, maximum: 2 },
    detail: { type: 'string', minLength: 1, maxLength: 2048 },
  },
  required: ['phase', 'attempt'],
  additionalProperties: false,
} as const

export function readRepairProgress(value: unknown): {
  phase: RepairPhase
  attempt: number
  detail?: string
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid repair update.')
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).some((key) => !['phase', 'attempt', 'detail'].includes(key)) ||
    !repairPhases.includes(record.phase as RepairPhase) ||
    !Number.isSafeInteger(record.attempt) ||
    (record.attempt as number) < 0 ||
    (record.attempt as number) > 2 ||
    (record.detail !== undefined &&
      (typeof record.detail !== 'string' || !record.detail || [...record.detail].length > 2048)) ||
    (['command', 'observed', 'rejected'].includes(record.phase as string) &&
      record.detail === undefined)
  )
    throw new TypeError('Invalid repair update.')
  return record as { phase: RepairPhase; attempt: number; detail?: string }
}

/** Descriptive data, never a command to paste or a model explanation. */
export function quoted(value: string, limit = 120): string {
  const prefix = [...value].slice(0, limit).join('')
  const safe = JSON.stringify(prefix).replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
    character
      .split('')
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
  )
  return safe + (prefix === value ? '' : ' [truncated]')
}

/** These checks are worker observations; the factory validates the final evidence. */
export function observedChecks(evaluation: Evaluation, attempt: number, maximum: number): string {
  const failed = evaluation.acceptance.filter((c) => !c.passed)
  const invocations = [
    ...new Set(evaluation.commands.map((command) => JSON.stringify(command.invocation))),
  ]
  const commands = invocations
    .slice(0, 3)
    .map((value) => {
      const args = JSON.parse(value) as string[]
      return (
        args
          .slice(0, 6)
          .map((arg) => quoted(arg, 64))
          .join(' ') + (args.length > 6 ? ' [more arguments in evidence]' : '')
      )
    })
    .join('; ')
  return [
    `${attempt === 0 ? 'Baseline' : `Proposed fix ${attempt}`} check report:`,
    `  Repository test command ${evaluation.repositoryTestsPassed ? 'passed' : 'failed'}.`,
    `  Independent acceptance cases: ${evaluation.acceptance.length - failed.length}/${evaluation.acceptance.length} passed.`,
    `  ${failed.length ? 'Mismatched' : 'Passing'} cases: ${(failed.length ? failed : evaluation.acceptance).map((c) => quoted(c.id, 32)).join(', ')}.`,
    `  Observed commands: ${commands}${invocations.length > 3 ? '; more in returned evidence' : ''}.`,
    `  Next: ${
      attempt === 0
        ? failed.length
          ? 'request a proposed fix using these observed discrepancies.'
          : 'stop because the independent cases did not reproduce the defect.'
        : evaluation.accepted
          ? 'return the patch and check evidence for independent factory verification.'
          : attempt < maximum
            ? 'request a correction using the failed checks.'
            : 'stop; the proposal budget is exhausted.'
    }`,
  ].join('\n')
}

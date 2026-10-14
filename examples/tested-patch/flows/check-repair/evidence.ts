import type { RunResult } from '@jigging/flow'
import { checkCommands } from './commands.ts'
import { identity } from './identity.ts'
import type { CapturedProject, Check, RepairEvidence, Replacement } from './types.ts'

export function checkRepair(input: CapturedProject, result: RunResult) {
  const evidence = result.output as unknown as RepairEvidence
  if (
    !evidence ||
    evidence.baseDigest !== identity(input.files) ||
    evidence.acceptanceDigest !== identity(input.cases)
  ) {
    throw new TypeError('Repair evidence does not match the captured input.')
  }
  if (
    !Array.isArray(evidence.attempts) ||
    evidence.attempts.length > 2 ||
    typeof evidence.reason !== 'string'
  ) {
    throw new TypeError('Supply a repair reason and at most two attempts.')
  }
  const baseline = checkCommands(input, input.files, evidence.baseline)
  const proposals: { number: number; replacements: Replacement[] }[] = []
  const attempts: { evaluation?: Check; invalidProposal?: string }[] = []
  let lastAccepted = false
  for (const [index, attempt] of evidence.attempts.entries()) {
    lastAccepted = false
    if (attempt.proposal === undefined) {
      if (typeof attempt.invalidProposal !== 'string')
        throw new TypeError('Missing proposal or rejection reason.')
      attempts.push({ invalidProposal: attempt.invalidProposal })
      continue
    }
    const replacements = attempt.proposal.replacements
    if (
      !Array.isArray(replacements) ||
      replacements.length < 1 ||
      replacements.length > input.editPaths.length
    ) {
      throw new TypeError('Invalid replacement set.')
    }
    if (new Set(replacements.map((file) => file.path)).size !== replacements.length) {
      throw new TypeError('Replacement paths must be unique.')
    }
    const files = { ...input.files }
    for (const file of replacements) {
      if (!input.editPaths.includes(file.path)) throw new TypeError('Unapproved replacement path.')
      if (
        typeof file.content !== 'string' ||
        Buffer.byteLength(file.content) > 65536 ||
        file.content.includes('\0') ||
        Buffer.from(file.content).toString('utf8') !== file.content
      ) {
        throw new TypeError('Replacement content must be bounded Unicode text without NUL.')
      }
      files[file.path] = file.content
    }
    const size = Object.values(files).reduce(
      (total, content) => total + Buffer.byteLength(content),
      0,
    )
    if (size > 65536 || attempt.candidateDigest !== identity(files)) {
      throw new TypeError('Candidate identity or size differs from its replacement bytes.')
    }
    proposals.push({ number: index + 1, replacements })
    const evaluation = attempt.evaluation
      ? checkCommands(input, files, attempt.evaluation)
      : undefined
    attempts.push(evaluation ? { evaluation } : {})
    lastAccepted = evaluation?.accepted ?? false
  }
  const ready = result.outcome === 'done'
  const changed =
    proposals.at(-1)?.replacements.some((file) => file.content !== input.files[file.path]) ?? false
  const reproduced = baseline.acceptance.some((item) => !item.passed)
  if (ready && (!lastAccepted || !reproduced || !changed)) {
    throw new TypeError('Completion lacks a reproduced defect and independently accepted patch.')
  }
  return { ready, proposals, reason: evidence.reason, baseline, attempts }
}

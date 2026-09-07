import { isDeepStrictEqual } from 'node:util'
import { digest, sha256, object, type RepairInput } from './policy.ts'

export interface CommandEvidence {
  candidateDigest: string
  command: string
  invocation: string[]
  stdinDigest: string
  stdout: { text: string; truncated: boolean }
  stderr: { text: string; truncated: boolean }
  exitCode: number | null
  signal: string | null
  stopReason: string
  cleanup: string
}
export interface Evaluation {
  candidateDigest: string
  commands: CommandEvidence[]
  acceptance: { id: string; passed: boolean }[]
  repositoryTestsPassed: boolean
  accepted: boolean
}

/** Evaluate observations in this admitted method, never in the candidate process. */
export function evaluate(
  input: RepairInput,
  files: Record<string, string>,
  values: unknown[],
): Evaluation {
  if (values.length !== 1 + input.cases.length) throw new TypeError('Missing command observations.')
  const candidateDigest = digest(files)
  const commands = values.map((value, index) => {
    const c = object(value) as CommandEvidence
    if (
      c.candidateDigest !== candidateDigest ||
      c.cleanup !== 'complete' ||
      c.stopReason !== 'exited' ||
      c.command !== (index === 0 ? 'tests' : 'cli') ||
      c.stdinDigest !== sha256(index === 0 ? '' : input.cases[index - 1]!.stdin)
    )
      throw new TypeError('Command identity or termination does not match this evaluation.')
    if (
      !Array.isArray(c.invocation) ||
      c.invocation[0] !== 'bun' ||
      (index === 0
        ? c.invocation[1] !== 'test'
        : !isDeepStrictEqual(c.invocation.slice(2), input.cases[index - 1]!.args))
    )
      throw new TypeError('Command invocation does not match the reviewed method.')
    for (const stream of [c.stdout, c.stderr])
      if (typeof stream?.text !== 'string' || typeof stream.truncated !== 'boolean')
        throw new TypeError('Missing collected command output.')
    if (
      (c.exitCode !== null && (!Number.isInteger(c.exitCode) || c.exitCode < 0)) ||
      (c.signal !== null && typeof c.signal !== 'string')
    )
      throw new TypeError('Missing collected termination.')
    return c
  })
  const acceptance = input.cases.map((c, i) => {
    const observed = commands[i + 1]!
    return {
      id: c.id,
      passed:
        observed.signal === null &&
        observed.exitCode === c.exitCode &&
        !observed.stdout.truncated &&
        !observed.stderr.truncated &&
        observed.stdout.text === c.stdout &&
        observed.stderr.text === c.stderr,
    }
  })
  const repositoryTestsPassed =
    commands[0]!.exitCode === 0 &&
    commands[0]!.signal === null &&
    !commands[0]!.stdout.truncated &&
    !commands[0]!.stderr.truncated
  return {
    candidateDigest,
    commands,
    acceptance,
    repositoryTestsPassed,
    accepted: repositoryTestsPassed && acceptance.every((c) => c.passed),
  }
}

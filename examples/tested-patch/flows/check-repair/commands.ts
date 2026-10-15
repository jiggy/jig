import { isDeepStrictEqual } from 'node:util'
import { hashText, identity } from './identity.ts'
import type { CapturedProject, Check, Evaluation } from './types.ts'

export function checkCommands(
  input: CapturedProject,
  files: Record<string, string>,
  evaluation: Evaluation,
): Check {
  if (!evaluation || evaluation.candidateDigest !== identity(files)) {
    throw new TypeError('Command evidence identifies a different candidate.')
  }
  if (
    !Array.isArray(evaluation.commands) ||
    evaluation.commands.length !== input.cases.length + 1
  ) {
    throw new TypeError('Incomplete command evidence.')
  }
  for (const [index, command] of evaluation.commands.entries()) {
    if (command.candidateDigest !== identity(files))
      throw new TypeError('A command identifies a different candidate.')
    if (command.cleanup !== 'complete' || command.stopReason !== 'exited') {
      throw new TypeError('Command termination or cleanup is unconfirmed.')
    }
    const expectedInput = index === 0 ? '' : input.cases[index - 1]!.stdin
    if (command.stdinDigest !== hashText(expectedInput))
      throw new TypeError('Command stdin differs from the fixed case.')
    const expectedInvocation =
      index === 0
        ? ['bun', 'test', 'test/project.test.ts']
        : ['bun', 'src/cli.ts', ...input.cases[index - 1]!.args]
    if (!isDeepStrictEqual(command.invocation, expectedInvocation)) {
      throw new TypeError('Command invocation does not match the complete reviewed command.')
    }
    for (const stream of [command.stdout, command.stderr]) {
      if (!stream || typeof stream.text !== 'string' || typeof stream.truncated !== 'boolean') {
        throw new TypeError('Missing command logs.')
      }
    }
  }
  const acceptance = input.cases.map((expected, index) => {
    const observed = evaluation.commands[index + 1]!
    return {
      id: expected.id,
      passed:
        observed.exitCode === expected.exitCode &&
        observed.signal === null &&
        !observed.stdout.truncated &&
        !observed.stderr.truncated &&
        observed.stdout.text === expected.stdout &&
        observed.stderr.text === expected.stderr,
    }
  })
  const tests = evaluation.commands[0]!
  const repositoryTestsPassed =
    tests.exitCode === 0 &&
    tests.signal === null &&
    !tests.stdout.truncated &&
    !tests.stderr.truncated
  const accepted = repositoryTestsPassed && acceptance.every((item) => item.passed)
  if (
    identity(acceptance) !== identity(evaluation.acceptance) ||
    repositoryTestsPassed !== evaluation.repositoryTestsPassed ||
    accepted !== evaluation.accepted
  ) {
    throw new TypeError('The reported verdict contradicts collected command behavior.')
  }
  return { accepted, acceptance, repositoryTestsPassed }
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import cases from '../flows/read-project/logs-cases.json'
import { evaluate } from '../flows/repair/evidence.ts'
import { candidate, digest, type RepairInput, sha256 } from '../flows/repair/policy.ts'
import issue from '../issue.json'

export const input: RepairInput = {
  ...issue,
  cases,
  files: Object.fromEntries(
    await Promise.all(
      [
        'src/parse.ts',
        'src/report.ts',
        'src/cli.ts',
        'test/project.test.ts',
        'README.md',
        'package.json',
      ].map(async (path) => [
        path,
        await readFile(join(import.meta.dir, '../fixtures/log-report', path), 'utf8'),
      ]),
    ),
  ),
}
export const proposal = {
  summary: 'Validate HTTP status codes and separate server errors.',
  replacements: [
    {
      path: 'src/parse.ts',
      content: input.files['src/parse.ts']!.replace(
        "typeof value.status !== 'number'",
        '!Number.isInteger(value.status) || value.status < 100 || value.status > 599',
      ),
    },
    {
      path: 'src/report.ts',
      content: input.files['src/report.ts']!.replace(
        'r.status >= 400).length',
        'r.status >= 500).length',
      ),
    },
  ],
}
// Ordinary validator input data only. These values attest no command execution,
// native termination, cleanup, Agent call, or retained session.
export function commandRecordData(
  command: string,
  files: Record<string, string>,
  args: string[],
  stdin: string,
  passes: boolean,
) {
  const c = cases.find((c) => c.stdin === stdin && JSON.stringify(c.args) === JSON.stringify(args))
  return {
    candidateDigest: digest(files),
    invocation:
      command === 'tests'
        ? ['bun', 'test', 'test/project.test.ts']
        : ['bun', 'src/cli.ts', ...args],
    stdinDigest: sha256(stdin),
    stdout: { text: command === 'tests' ? '' : passes ? c!.stdout : 'wrong\n', truncated: false },
    stderr: {
      text: command === 'tests' ? 'validator input data\n' : passes ? c!.stderr : '',
      truncated: false,
    },
    exitCode: command === 'tests' ? (passes ? 0 : 1) : passes ? c!.exitCode : 0,
    signal: null,
    stopReason: 'exited',
    cleanup: 'complete',
  }
}
export function repairResultData(success = true) {
  const files = candidate(input, proposal)
  const evaluationData = (files: Record<string, string>, passes: boolean) =>
    evaluate(input, files, [
      commandRecordData('tests', files, [], '', passes),
      ...input.cases.map((c) => commandRecordData('cli', files, c.args, c.stdin, passes)),
    ])
  const attemptData = () => ({
    proposal: structuredClone(proposal),
    candidateDigest: digest(files),
    evaluation: evaluationData(files, success),
  })
  return {
    outcome: success ? 'done' : 'blocked',
    output: {
      baseDigest: digest(input.files),
      acceptanceDigest: digest(input.cases),
      reason: 'Validator input data, not execution evidence.',
      baseline: evaluationData(input.files, false),
      attempts: success ? [attemptData()] : [attemptData(), attemptData()],
    },
  }
}

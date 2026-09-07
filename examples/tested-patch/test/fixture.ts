import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OperationError } from '@jigging/flow'
import cases from '../flows/project/cases.json'
import issue from '../issue.json'
import { digest, sha256, type RepairInput } from '../flows/repair/policy.ts'
import { repair } from '../flows/repair/repair.ts'

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
export function recorded(
  command: string,
  files: Record<string, string>,
  args: string[],
  stdin: string,
  passes: boolean,
) {
  const c = cases.find((c) => c.stdin === stdin && JSON.stringify(c.args) === JSON.stringify(args))
  return {
    candidateDigest: digest(files),
    command,
    invocation:
      command === 'tests'
        ? ['bun', 'test', 'test/project.test.ts']
        : ['bun', 'src/cli.ts', ...args],
    stdinDigest: sha256(stdin),
    stdout: { text: command === 'tests' ? '' : passes ? c!.stdout : 'wrong\n', truncated: false },
    stderr: {
      text: command === 'tests' ? 'synthetic repository output\n' : passes ? c!.stderr : '',
      truncated: false,
    },
    exitCode: command === 'tests' ? (passes ? 0 : 1) : passes ? c!.exitCode : 0,
    signal: null,
    stopReason: 'exited',
    cleanup: 'complete',
  }
}
export async function syntheticRepair(
  options: {
    success?: boolean
    invalid?: boolean
    failCommand?: string
    alreadyPasses?: boolean
  } = {},
) {
  let agents = 0,
    commands = 0
  const result = await repair({
    input: input as any,
    signal: new AbortController().signal,
    callCapability: async (call) => {
      if (call.slot === 'agent') {
        agents++
        return {
          outcome: 'completed',
          structured: options.invalid
            ? { ...proposal, replacements: [{ path: 'test/project.test.ts', content: '' }] }
            : proposal,
        }
      }
      commands++
      if (options.failCommand && call.operationId.startsWith('attempt-'))
        throw new OperationError(options.failCommand as any, 'Synthetic interruption.')
      const p = call.input as any
      return recorded(
        p.command,
        p.files,
        p.args,
        p.stdin,
        options.alreadyPasses || (options.success !== false && agents > 0),
      )
    },
  })
  return { result, agents, commands }
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digest, type RepairInput, sha256 } from 'tested-patch-repair-flow/policy'
import { repair } from 'tested-patch-repair-flow/repair'
import cases from '../flows/factory/logs-cases.json'

export const input: RepairInput = {
  issue: 'Reject fractional and out-of-range HTTP status codes. Count 4xx separately from 5xx.',
  editPaths: ['src/parse.ts', 'src/report.ts'],
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

const proposal = {
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

function recorded(
  command: string,
  files: Record<string, string>,
  args: string[],
  stdin: string,
  passes: boolean,
) {
  const selected = cases.find(
    (candidate) =>
      candidate.stdin === stdin && JSON.stringify(candidate.args) === JSON.stringify(args),
  )
  return {
    candidateDigest: digest(files),
    invocation:
      command === 'tests'
        ? ['bun', 'test', 'test/project.test.ts']
        : ['bun', 'src/cli.ts', ...args],
    stdinDigest: sha256(stdin),
    stdout: {
      text: command === 'tests' ? '' : passes ? selected!.stdout : 'wrong\n',
      truncated: false,
    },
    stderr: {
      text: command === 'tests' ? 'synthetic repository output\n' : passes ? selected!.stderr : '',
      truncated: false,
    },
    exitCode: command === 'tests' ? (passes ? 0 : 1) : passes ? selected!.exitCode : 0,
    signal: null,
    stopReason: 'exited',
    cleanup: 'complete',
  }
}

export async function syntheticRepair() {
  let agents = 0
  const result = await repair({
    input,
    signal: new AbortController().signal,
    channels: {},
    call: async (call) => {
      if (call.slot === 'agent') {
        agents++
        return { outcome: 'done', output: { text: 'Synthetic proposal.', structured: proposal } }
      }
      const value = call.input as {
        files: Record<string, string>
        args: string[]
        stdin: string
      }
      return {
        outcome: 'done',
        output: recorded(call.slot, value.files, value.args, value.stdin, agents > 0),
      }
    },
  })
  return { result }
}

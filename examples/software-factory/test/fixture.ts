import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import cases from '../flows/factory/logs-cases.json'
import type { RepairInput } from '../flows/repair/policy.ts'

// Ordinary projection input, never an execution or cleanup receipt.
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

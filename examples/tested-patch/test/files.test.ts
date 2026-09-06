import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixture from '../fixtures/utf8.json'
import cases from '../flows/repair/checks.json'
import { sha256, snapshotDigest, unifiedPatch } from '../flows/repair/policy.ts'
import { inspect, type Acceptance } from '../flows/repair/evidence.ts'
import { readRepairInput, writeRepairDeliverables } from '../flows/repair/files.ts'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'jig-repair-files-'))
  directories.push(path)
  return path
}
const acceptance: Acceptance = {
  checkerSha256: sha256(await Bun.file(join(import.meta.dir, '../flows/repair/check.ts')).text()),
  casesSha256: sha256(await Bun.file(join(import.meta.dir, '../flows/repair/checks.json')).text()),
  cases: cases.cases,
}
function result() {
  const log = (text: string) => ({ text, bytes: Buffer.byteLength(text), truncated: false })
  const check = (passes: boolean) => ({
    checkerSha256: acceptance.checkerSha256,
    casesSha256: acceptance.casesSha256,
    exitCode: passes ? 0 : 1,
    signal: null,
    stdout: log(
      JSON.stringify({
        results: cases.cases.map(({ id, expected }, index) => ({
          id,
          expected,
          actual: !passes && index === 0 ? { returned: 'wrong' } : expected,
          passed: passes || index !== 0,
        })),
      }) + '\n',
    ),
    stderr: log(''),
  })
  const before = fixture.snapshot.files.find((file) => file.path === fixture.editPath)!.content
  const replacement = 'export function truncateUtf8() { /* synthetic evidence fixture */ }\n'
  return {
    outcome: 'done',
    output: {
      reason: 'Synthetic passing record.',
      baseSha256: fixture.snapshot.sha256,
      baseline: check(false),
      attempts: [
        {
          patchedSha256: snapshotDigest(
            fixture.snapshot.files.map((file) =>
              file.path === fixture.editPath ? { ...file, content: replacement } : file,
            ),
          ),
          patch: {
            path: fixture.editPath,
            beforeSha256: sha256(before),
            replacement,
            unified: unifiedPatch(fixture.editPath, before, replacement),
            summary: 'Synthetic.',
          },
          tested: check(true),
        },
      ],
    },
  }
}

describe('method-owned file input and deliverables', () => {
  test('reads bounded UTF-8 attachment bytes with BOM and builds its own snapshot identity', async () => {
    const root = await directory(),
      content = '\uFEFFexport const emoji = "😀"\r\n'
    await writeFile(join(root, 'code.ts'), content)
    const input = await readRepairInput({ issue: 'Fix.', editPath: 'code.ts' }, root)
    expect(input.snapshot.files).toEqual([{ path: 'code.ts', content }])
    expect(input.snapshot.sha256).toBe(snapshotDigest(input.snapshot.files))
    await expect(readRepairInput({ ...input }, root)).rejects.toThrow('Supply only')
  })
  test('rejects invalid UTF-8, symlinks, oversized text, and a missing edit path', async () => {
    const root = await directory()
    const input = { issue: 'Fix.', editPath: 'code.ts' }
    await writeFile(join(root, 'code.ts'), new Uint8Array([255]))
    await expect(readRepairInput(input, root)).rejects.toThrow()
    await writeFile(join(root, 'code.ts'), 'x'.repeat(65537))
    await expect(readRepairInput(input, root)).rejects.toThrow()
    await writeFile(join(root, 'code.ts'), 'valid text')
    await expect(readRepairInput({ ...input, editPath: 'missing.ts' }, root)).rejects.toThrow()
    await symlink('code.ts', join(root, 'linked.ts'))
    await expect(readRepairInput(input, root)).rejects.toThrow()
  })
  test('writes review.patch only from complete, consistent evidence', async () => {
    const out = await directory(),
      value = result()
    await writeRepairDeliverables(out, fixture, value)
    expect((await readdir(out)).sort()).toEqual(['proposal-1.patch', 'review.patch', 'summary.txt'])
    expect(await readFile(join(out, 'review.patch'), 'utf8')).toBe(
      value.output.attempts[0]!.patch.unified,
    )
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain('review-ready')
  })
  test('preserves unsuccessful proposals without naming them review-ready', async () => {
    const out = await directory(),
      value = result()
    value.outcome = 'blocked'
    await writeRepairDeliverables(out, fixture, value)
    expect((await readdir(out)).sort()).toEqual(['proposal-1.patch', 'summary.txt'])
    expect(await readFile(join(out, 'summary.txt'), 'utf8')).toContain('unsuccessful')
  })
})

test('method checks reject tampered identity, verdict, history, and incomplete logs before writing files', async () => {
  const mutations: ((value: any) => void)[] = [
    (t) => {
      t.output.baseSha256 = 'wrong'
    },
    (t) => {
      t.output.attempts[0].patch.beforeSha256 = 'wrong'
    },
    (t) => {
      t.output.attempts[0].patchedSha256 = 'wrong'
    },
    (t) => {
      t.output.attempts[0].patch.replacement += 'changed'
    },
    (t) => {
      t.output.attempts[0].patch.unified += '\n'
    },
    (t) => {
      t.output.attempts[0].patch.path = 'checks.json'
    },
    (t) => {
      t.output.attempts[0].tested.checkerSha256 = 'wrong'
    },
    (t) => {
      t.output.attempts[0].tested.casesSha256 = 'wrong'
    },
    (t) => {
      t.output.attempts[0].tested.stdout.truncated = true
    },
    (t) => {
      t.output.attempts[0].tested.stdout.bytes++
    },
    (t) => {
      t.output.attempts[0].tested.exitCode = 1
    },
    (t) => {
      t.output.attempts[0].tested.signal = 'SIGKILL'
    },
    (t) => {
      t.output.baseline = t.output.attempts[0].tested
    },
    (t) => {
      delete t.output.attempts[0].tested
    },
    (t) => {
      t.output.attempts[0].failure = { code: 'INVALID_RESULT' }
    },
    (t) => {
      t.output.attempts = []
    },
    (t) => {
      const tested = t.output.attempts[0].tested,
        report = JSON.parse(tested.stdout.text)
      report.results[0].actual = { returned: 'wrong' }
      tested.stdout.text = JSON.stringify(report)
      tested.stdout.bytes = Buffer.byteLength(tested.stdout.text)
    },
  ]
  for (const mutate of mutations) {
    const changed = result()
    mutate(changed)
    expect(inspect(changed, fixture, acceptance).status).toBe('invalid-evidence')
    const out = await directory()
    await expect(writeRepairDeliverables(out, fixture, changed)).rejects.toThrow()
    expect(await readdir(out)).toEqual([])
  }
})

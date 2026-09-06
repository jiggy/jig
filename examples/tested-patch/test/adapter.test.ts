import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fixture from '../fixtures/utf8.json'
import cases from '../flows/repair/checks.json'
import { sha256, snapshotDigest, unifiedPatch } from '../flows/repair/policy.ts'
import { type Acceptance, inspect } from '../packet.ts'
import { main } from '../repair.ts'
import { capture } from '../snapshot.ts'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true })
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'jig-tested-patch-adapter-'))
  directories.push(path)
  return path
}
const acceptance: Acceptance = {
  checkerSha256: sha256(await Bun.file(join(import.meta.dir, '../flows/repair/check.ts')).text()),
  casesSha256: sha256(await Bun.file(join(import.meta.dir, '../flows/repair/checks.json')).text()),
  cases: cases.cases,
}
// Synthetic terminal evidence tests the exporter, not execution or model quality.
function terminal() {
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
  const replacement = 'export function truncateUtf8() { /* synthetic exporter fixture */ }\n'
  return {
    status: 'succeeded',
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

describe('explicit repository capture', () => {
  test('captures exactly selected UTF-8 bytes, including BOM, without running or reading configuration', async () => {
    const root = await directory()
    const content = '\uFEFFexport const emoji = "😀"\r\n'
    await writeFile(join(root, 'code.ts'), content)
    await writeFile(join(root, 'bunfig.toml'), 'preload = ["./evil.ts"]')
    await writeFile(join(root, 'evil.ts'), 'throw new Error("must never run")')
    const { input } = await capture(root, 'code.ts', [], 'Fix.')
    expect(input.snapshot.files).toEqual([{ path: 'code.ts', content }])
    expect(input.snapshot.sha256).toBe(snapshotDigest(input.snapshot.files))
  })
  test('rejects traversal, duplicates, symlinks at every selected level, directories, and invalid UTF-8', async () => {
    const root = await directory()
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/code.ts'), 'source')
    await symlink('src', join(root, 'linked'))
    await symlink('src/code.ts', join(root, 'link.ts'))
    await mkdir(join(root, 'directory.ts'))
    await writeFile(join(root, 'bad.ts'), new Uint8Array([0xff]))
    for (const path of [
      '../escape.ts',
      '/absolute.ts',
      'src/../code.ts',
      'linked/code.ts',
      'link.ts',
      'directory.ts',
      'bad.ts',
    ])
      await expect(capture(root, path, [], 'Fix.')).rejects.toThrow()
    await expect(capture(root, 'src/code.ts', ['src/code.ts'], 'Fix.')).rejects.toThrow('duplicate')
  })
  test('bounds aggregate source and JSON argument sizes', async () => {
    const root = await directory()
    await writeFile(join(root, 'a.ts'), 'x'.repeat(40000))
    await writeFile(join(root, 'b.ts'), 'x'.repeat(40000))
    await expect(capture(root, 'a.ts', ['b.ts'], 'Fix.')).rejects.toThrow('64 KiB')
    await writeFile(join(root, 'escaped.ts'), '\u0000'.repeat(30000))
    await expect(capture(root, 'escaped.ts', [], 'Fix.')).rejects.toThrow('argument limit')
    await expect(capture(root, 'a.ts', [], ' ')).rejects.toThrow('issue')
  })
})

describe('truthful patch classification', () => {
  test('requires failing original, matching content identities, and executed passing checks', () => {
    const result = inspect(terminal(), fixture, acceptance)
    expect(result.status).toBe('review-ready')
    expect(result.baseline?.exitCode).toBe(1)
    expect(result.attempts[0].checks).toEqual({ passed: 12, total: 12, exitCode: 0 })
    const mutations = [
      (t: any) => {
        t.output.baseSha256 = 'wrong'
      },
      (t: any) => {
        t.output.attempts[0].patchedSha256 = 'wrong'
      },
      (t: any) => {
        t.output.attempts[0].patch.unified += '\n'
      },
      (t: any) => {
        t.output.attempts[0].patch.path = 'checks.json'
      },
      (t: any) => {
        t.output.attempts[0].tested.casesSha256 = 'wrong'
      },
      (t: any) => {
        t.output.attempts[0].tested.stdout.truncated = true
      },
      (t: any) => {
        t.output.attempts[0].tested.exitCode = 1
      },
      (t: any) => {
        t.output.attempts[0].tested.signal = 'SIGKILL'
      },
      (t: any) => {
        t.output.baseline = t.output.attempts[0].tested
      },
      (t: any) => {
        delete t.output.attempts[0].tested
      },
      (t: any) => {
        t.output.attempts[0].failure = { code: 'INVALID_RESULT' }
      },
      (t: any) => {
        t.output.attempts = []
      },
    ]
    for (const mutate of mutations) {
      const changed = terminal()
      mutate(changed)
      expect(inspect(changed, fixture, acceptance).status).toBe('invalid-evidence')
    }
  })
  test('does not trust a forged case pass, and retains proposals from failed terminal details', () => {
    const forged = terminal()
    const tested = forged.output.attempts[0].tested
    const report = JSON.parse(tested.stdout.text)
    report.results[0].actual = { returned: 'wrong' }
    tested.stdout.text = JSON.stringify(report)
    tested.stdout.bytes = Buffer.byteLength(tested.stdout.text)
    expect(inspect(forged, fixture, acceptance).status).toBe('invalid-evidence')
    const original = terminal()
    const attempt: any = original.output.attempts[0]
    delete attempt.tested
    attempt.failure = { code: 'INVALID_RESULT' }
    const result = inspect(
      { status: 'failed', message: 'Candidate invalid.', details: original.output },
      fixture,
      acceptance,
    )
    expect(result.status).toBe('unsuccessful')
    expect(result.proposals).toHaveLength(1)
    expect(result.attempts[0].checks).toBeUndefined()
  })
  test('a blocked outcome or lost terminal never becomes review-ready', () => {
    const t = terminal()
    t.outcome = 'blocked'
    expect(inspect(t, fixture, acceptance).status).toBe('unsuccessful')
    expect(
      inspect({ status: 'lost', message: 'Coordinator lost.' }, fixture, acceptance).status,
    ).toBe('unsuccessful')
  })
})

async function setup(script: string) {
  const root = await directory()
  const repo = join(root, 'repository')
  await mkdir(join(repo, 'src'), { recursive: true })
  for (const file of fixture.snapshot.files) await writeFile(join(repo, file.path), file.content)
  const jig = join(root, 'jig-double')
  await writeFile(jig, `#!${process.execPath}\n${script}\n`)
  await chmod(jig, 0o700)
  const out = join(root, 'packet')
  return {
    root,
    repo,
    out,
    args: [
      '--repo',
      repo,
      '--edit',
      fixture.editPath,
      '--file',
      'README.md',
      '--issue',
      fixture.issue,
      '--out',
      out,
      '--jig',
      jig,
    ],
  }
}

describe('repository command using an explicitly synthetic Jig executable', () => {
  test('writes raw evidence and review.patch outside the untouched repository', async () => {
    const raw = JSON.stringify(terminal(), null, 2) + '\n'
    const app = await setup(
      `const args=process.argv.slice(2); if(args[0]!=="run" || args[1]!=="binding:repair" || args.at(-1)!=="5m") throw Error("unexpected command"); process.stdout.write(${JSON.stringify(raw)});`,
    )
    expect(await main(app.args, new AbortController().signal)).toBe(0)
    expect(await readFile(join(app.out, 'terminal.json'), 'utf8')).toBe(raw)
    expect(await readFile(join(app.out, 'review.patch'), 'utf8')).toBe(
      terminal().output.attempts[0].patch.unified,
    )
    const captured = JSON.parse(await readFile(join(app.out, 'input.json'), 'utf8'))
    expect(captured.snapshot.sha256).toBe(fixture.snapshot.sha256)
    expect(
      captured.snapshot.files.toSorted((a: any, b: any) => a.path.localeCompare(b.path)),
    ).toEqual(fixture.snapshot.files)
    for (const file of fixture.snapshot.files)
      expect(await readFile(join(app.repo, file.path), 'utf8')).toBe(file.content)
    await expect(main(app.args, new AbortController().signal)).rejects.toThrow('EEXIST')
  })
  test('refuses an output inside the repository, including a symlinked parent', async () => {
    const app = await setup('throw Error("must not dispatch")')
    await symlink(app.repo, join(app.root, 'alias'))
    app.args[app.args.indexOf('--out') + 1] = join(app.root, 'alias', 'packet')
    await expect(main(app.args, new AbortController().signal)).rejects.toThrow('outside')
    expect(await readdir(app.repo)).toEqual(['README.md', 'src'])
  })
  test('records missing terminals, nonzero exits and unsuccessful checks without review.patch', async () => {
    for (const script of [
      'console.error("not admitted"); process.exitCode=1;',
      `console.log(JSON.stringify(${JSON.stringify(terminal())})); process.exitCode=1;`,
    ]) {
      const app = await setup(script)
      expect(await main(app.args, new AbortController().signal)).toBe(2)
      expect(await readdir(app.out)).not.toContain('review.patch')
      expect(await readFile(join(app.out, 'summary.txt'), 'utf8')).toContain(
        'No review-ready patch',
      )
    }
    const t = terminal()
    t.outcome = 'blocked'
    t.output.attempts[0].tested = t.output.baseline
    const app = await setup(`console.log(JSON.stringify(${JSON.stringify(t)}))`)
    expect(await main(app.args, new AbortController().signal)).toBe(1)
    expect(await readdir(app.out)).toContain('proposal-1.patch')
    expect(await readdir(app.out)).not.toContain('review.patch')
  })
  test('cancellation waits for the child acknowledgement and never retries', async () => {
    const app = await setup(
      'process.on("SIGINT",()=>{console.error("settled"); process.exit(130)}); console.log("ready"); setInterval(()=>{},1000);',
    )
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 150)
    try {
      expect(await main(app.args, controller.signal)).toBe(130)
      expect(await readFile(join(app.out, 'stderr.txt'), 'utf8')).toContain('settled')
      expect(await readdir(app.out)).not.toContain('review.patch')
    } finally {
      clearTimeout(timer)
    }
  })
  test('bounded output requests cancellation and never accepts a partial terminal', async () => {
    const app = await setup(
      'process.on("SIGINT",()=>process.exit(130)); process.stdout.write("x".repeat(1100000)); setInterval(()=>{},1000);',
    )
    expect(await main(app.args, new AbortController().signal)).toBe(2)
    expect((await readFile(join(app.out, 'stdout.txt'))).byteLength).toBe(1048576)
    expect(JSON.parse(await readFile(join(app.out, 'execution.json'), 'utf8')).outputLimit).toBe(
      true,
    )
    expect(await readdir(app.out)).not.toContain('terminal.json')
    expect(await readdir(app.out)).not.toContain('review.patch')
  })
})

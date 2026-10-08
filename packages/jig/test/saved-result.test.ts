import { expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs'
import { link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { validateUserUpdate } from '@jigging/user-updates'
import { main, privateCliRequiresHost, privateCliSavedResultInspection } from '../src/cli.js'
import { PrivateRunModel } from '../src/cli-run-model.js'
import {
  privateSavedResultPlain,
  privateSavedResultViews,
} from '../src/cli-saved-result-presentation.js'
import { sha256 } from '../src/internal/file-input.js'
import { privateCaptureSavedResult } from '../src/internal/saved-result.js'
import { canonicalJson, JSON_1_LIMITS, type JsonValue } from '../src/json.js'
import { settleTestCommand } from './fixtures/bounded-command.js'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'jig-saved-result-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
function report(
  files: { path: string; bytes: number; digest: string }[] = [],
  extras: Record<string, JsonValue> = {},
) {
  return {
    status: 'succeeded',
    outcome: 'done',
    output: { summary: 'Checked patch ready for review; not applied.' },
    delivery: { status: 'written', destination: '/forged/historical/destination', files },
    ...extras,
  }
}
async function packet(
  root: string,
  contents: Record<string, Buffer> = {},
  extras: Record<string, JsonValue> = {},
) {
  const files: { path: string; bytes: number; digest: string }[] = []
  await mkdir(join(root, 'files'), { recursive: true })
  for (const [path, bytes] of Object.entries(contents)) {
    await mkdir(dirname(join(root, 'files', path)), { recursive: true })
    await writeFile(join(root, 'files', path), bytes)
    files.push({ path, bytes: bytes.length, digest: sha256(bytes) })
  }
  const value = report(files, extras)
  await writeFile(
    join(root, 'result.json'),
    Buffer.concat([Buffer.from(canonicalJson(value)), Buffer.from('\n')]),
  )
  return value
}

test('rejected allocations and collective close failures dispose bytes without losing primary interruption', async () =>
  fixture(async (root) => {
    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, 'saved-result-faults.ts'), root],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('saved capture buffer ownership and collective cleanup passed')
  }))

test('saved previews remain immutable after packet replacement and release on close', async () =>
  fixture(async (root) => {
    const selected = join(root, 'selected')
    await mkdir(selected)
    await packet(selected, {
      'review.patch': Buffer.from('original patch\n'),
      empty: Buffer.alloc(0),
      binary: Buffer.from([255, 0]),
    })
    const capture = privateCaptureSavedResult(selected)
    try {
      await rename(selected, join(root, 'moved'))
      await mkdir(selected)
      await packet(selected, { 'review.patch': Buffer.from('replacement patch\n') })
      await rm(join(root, 'moved'), { recursive: true })
      expect(capture.complete).toBeTrue()
      expect(capture.preview('review.patch')?.text).toBe('original patch\n')
      expect(capture.preview('empty')?.text).toBe('')
      expect(capture.preview('binary')).toBeUndefined()
    } finally {
      capture.close()
    }
    expect(capture.preview('review.patch')).toBeUndefined()
    expect(() => capture.reportPreview()).toThrow('closed')
  }))

test('partial file verification preserves the exact valid report and prior verified files', async () =>
  fixture(async (root) => {
    const value = await packet(root, {
      first: Buffer.from('first'),
      second: Buffer.from('second'),
      last: Buffer.from('last'),
    })
    await writeFile(join(root, 'files', 'second'), 'tamper')
    const capture = privateCaptureSavedResult(root)
    try {
      expect(capture.record).toEqual(value)
      expect(capture.complete).toBeFalse()
      expect(capture.preview('first')?.text).toBe('first')
      expect(capture.preview('second')).toBeUndefined()
      expect(capture.preview('last')).toBeUndefined()
      expect(capture.files.map((f) => f.available)).toEqual([true, false, false])
      expect(capture.finding).toContain('incomplete')
    } finally {
      capture.close()
    }
  }))

test('a write racing an opened file capture refuses that file and preserves the report', async () =>
  fixture(async (root) => {
    await packet(root, { patch: Buffer.from('initial patch') })
    const path = join(root, 'files', 'patch')
    const inode = fs.statSync(path, { bigint: true }).ino
    const original = fs.readSync
    let changed = false
    const intercepted = spyOn(fs, 'readSync').mockImplementation(((...args: any[]) => {
      const count = (original as any)(...args)
      if (!changed && fs.fstatSync(args[0], { bigint: true }).ino === inode) {
        changed = true
        fs.writeFileSync(path, 'a changed file with a different size')
      }
      return count
    }) as any)
    try {
      const capture = privateCaptureSavedResult(root)
      try {
        expect(changed).toBeTrue()
        expect(capture.complete).toBeFalse()
        expect(capture.record.status).toBe('succeeded')
        expect(capture.preview('patch')).toBeUndefined()
      } finally {
        capture.close()
      }
    } finally {
      intercepted.mockRestore()
    }
  }))

test('unread named pipes and symlinked artifacts cannot stall or escape capture', async () =>
  fixture(async (root) => {
    await packet(root, { patch: Buffer.from('patch') })
    await rm(join(root, 'files', 'patch'))
    await symlink('/etc/passwd', join(root, 'files', 'patch'))
    let capture = privateCaptureSavedResult(root)
    try {
      expect(capture.complete).toBeFalse()
      expect(capture.preview('patch')).toBeUndefined()
    } finally {
      capture.close()
    }
    await rm(join(root, 'files', 'patch'))
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, 'files', 'patch')]).exitCode).toBe(0)
    const before = performance.now()
    capture = privateCaptureSavedResult(root)
    try {
      expect(capture.complete).toBeFalse()
      expect(performance.now() - before).toBeLessThan(1000)
    } finally {
      capture.close()
    }
    await rm(join(root, 'result.json'))
    expect(Bun.spawnSync(['/usr/bin/mkfifo', join(root, 'result.json')]).exitCode).toBe(0)
    expect(() => privateCaptureSavedResult(root)).toThrow('valid result.json')
  }))

test('whole manifest refusal precedes reads and preserves only the valid report', async () =>
  fixture(async (root) => {
    const valid = { path: 'first', bytes: 0, digest: sha256(Buffer.alloc(0)) }
    for (const invalid of [
      [valid, { ...valid, path: '../escape' }],
      [valid, valid],
      [{ ...valid, bytes: -1 }],
      [{ ...valid, bytes: 16_777_217 }],
      [{ ...valid, digest: 'not-a-digest' }],
      [{ ...valid, path: '.jig/private' }],
      Array.from({ length: 65 }, (_, i) => ({ ...valid, path: `file-${i}` })),
    ]) {
      await writeFile(join(root, 'result.json'), JSON.stringify(report(invalid)))
      const capture = privateCaptureSavedResult(root)
      try {
        expect(capture.complete).toBeFalse()
        expect(capture.files).toEqual([])
        expect(capture.record.status).toBe('succeeded')
      } finally {
        capture.close()
      }
    }
  }))

test('saved capture refuses linked or special report files and linked artifact aliases', async () =>
  fixture(async (root) => {
    const selected = join(root, 'selected')
    await mkdir(selected)
    await packet(selected, { original: Buffer.from('bytes') })
    await symlink(join(selected, 'result.json'), join(root, 'result.json'))
    expect(() => privateCaptureSavedResult(root)).toThrow('valid result.json')
    await rm(join(root, 'result.json'))
    await link(join(selected, 'result.json'), join(root, 'result.json'))
    expect(() => privateCaptureSavedResult(root)).toThrow('valid result.json')
    await rm(join(root, 'result.json'))
    await link(join(selected, 'files', 'original'), join(selected, 'files', 'alias'))
    const capture = privateCaptureSavedResult(selected)
    try {
      expect(capture.complete).toBeFalse()
      expect(capture.preview('original')).toBeUndefined()
    } finally {
      capture.close()
    }
  }))

test('maximum delivered relative path retains its full depth and byte budget', async () =>
  fixture(async (root) => {
    const parts = Array.from({ length: 16 }, (_, i) => `${i}`.padEnd(i === 15 ? 47 : 30, 'a'))
    const path = parts.join('/')
    expect(Buffer.byteLength(path)).toBe(512)
    await packet(root, { [path]: Buffer.from('max path') })
    const capture = privateCaptureSavedResult(root)
    try {
      expect(capture.complete).toBeTrue()
      expect(capture.preview(path)?.text).toBe('max path')
    } finally {
      capture.close()
    }
  }))

test('all saved views fit retained model capacity with 64 maximum escaped file paths', async () =>
  fixture(async (root) => {
    const contents: Record<string, Buffer> = {}
    for (let index = 0; index < 64; index++) {
      const parts = Array.from({ length: 16 }, (_, component) =>
        component === 15 ? `${index}`.padEnd(47, '"') : '"'.repeat(30),
      )
      const path = parts.join('/')
      expect(Buffer.byteLength(path)).toBe(512)
      contents[path] = Buffer.from(`patch-${index}`)
    }
    await packet(root, contents, {
      output: { summary: '"'.repeat(4000), evidence: '"'.repeat(4000) },
      details: '"'.repeat(4000),
      diagnostics: { stderr: '\u0000'.repeat(5000), stderrTruncated: true },
      runDiagnostics: { entries: [], truncated: true },
    })
    const capture = privateCaptureSavedResult(root)
    try {
      const views = privateSavedResultViews(capture)
      const bytes = views.reduce(
        (total, view) => total + Buffer.byteLength(JSON.stringify(view)),
        0,
      )
      expect(bytes).toBeLessThanOrEqual(131_072)
      const model = new PrivateRunModel()
      model.workspace.recorded = true
      for (const view of views) expect(() => model.acceptView('saved-result', view)).not.toThrow()
      expect(model.views.size).toBe(3)
      const files = views.find((view) => view.id === 'files')!
      const collection = files.sections
        .flatMap((section) => section.blocks)
        .find((block) => block.kind === 'collection')!
      if (collection.kind !== 'collection') throw new Error('missing files collection')
      expect(collection.rows.length).toBe(64)
      expect(files.summary).toContain('Long table names are clipped')
      for (const row of collection.rows) {
        expect(String(row.cells.path)).toContain('[clipped]')
        const reference = row.cells.preview
        if (reference === null || typeof reference !== 'object' || reference.kind !== 'artifact')
          throw new Error('missing artifact preview reference')
        expect(Object.hasOwn(contents, reference.path)).toBeTrue()
        expect(capture.preview(reference.path)?.text).toBe(contents[reference.path]!.toString())
      }
    } finally {
      capture.close()
    }
  }))

test('report document boundary admits one publisher LF without relaxing JSON limits', async () =>
  fixture(async (root) => {
    const head = '{"status":"succeeded","outcome":"done","output":["'
    const separator = '","',
      tail = '"],"delivery":{"status":"written","files":[]}}'
    const payload = JSON_1_LIMITS.bytes - Buffer.byteLength(head + separator + tail)
    const first = 'a'.repeat(Math.floor(payload / 2)),
      second = 'b'.repeat(payload - first.length)
    const document = head + first + separator + second + tail
    expect(Buffer.byteLength(document)).toBe(JSON_1_LIMITS.bytes)
    await writeFile(join(root, 'result.json'), document + '\n')
    const capture = privateCaptureSavedResult(root)
    try {
      expect(capture.complete).toBeTrue()
      expect(capture.reportPreview().clipped).toBeTrue()
    } finally {
      capture.close()
    }
    await writeFile(join(root, 'result.json'), document + '\n\n')
    expect(() => privateCaptureSavedResult(root)).toThrow('valid result.json')
  }))

test('saved CLI does not acquire a project or inspect the environment, even for recorded failures', async () =>
  fixture(async (root) => {
    const value = await packet(
      root,
      {},
      { status: 'failed', code: 'RECORDED_FAILURE', message: 'original failure' },
    )
    let calls = 0,
      output = '',
      errors = ''
    const code = await main(['inspect', '--result', root, '--json'], {
      currentDirectory: '/',
      terminalOutput: true,
      terminalError: false,
      host: {
        acquire: async () => {
          calls++
          throw new Error('must not acquire')
        },
      },
      inspectEnvironment: async () => {
        calls++
        throw new Error('must not inspect')
      },
      writeRecord: async (text) => {
        output += text
      },
      writeError: (text) => {
        errors += text
      },
    })
    expect(code).toBe(0)
    expect(calls).toBe(0)
    expect(errors).toBe('')
    expect(JSON.parse(output)).toEqual(value)
    expect(privateCliRequiresHost(['inspect', '--result', root])).toBeFalse()
    expect(privateCliSavedResultInspection(['inspect', '--result', root])).toBeTrue()
  }))

test('partial JSON is unchanged, unavailable reports emit no invented value, and output failure is exit one', async () =>
  fixture(async (root) => {
    const value = await packet(root, { patch: Buffer.from('expected') })
    await rm(join(root, 'files', 'patch'))
    let output = '',
      errors = ''
    const options = {
      terminalOutput: false,
      terminalError: false,
      writeRecord: async (text: string) => {
        output += text
      },
      writeError: (text: string) => {
        errors += text
      },
    }
    expect(await main(['inspect', '--result', root], options)).toBe(1)
    expect(JSON.parse(output)).toEqual(value)
    expect(errors).toContain('JIG_RESULT_FILES_INCOMPLETE')
    output = ''
    errors = ''
    await writeFile(
      join(root, 'result.json'),
      '{"status":"succeeded","status":"evil rejected value"}',
    )
    expect(await main(['inspect', '--result', root, '--json'], options)).toBe(1)
    expect(output).toBe('')
    expect(errors).not.toContain('evil rejected value')
    await packet(root)
    expect(
      await main(['inspect', '--result', root, '--json'], {
        ...options,
        writeRecord: async () => {
          throw new Error('broken output')
        },
      }),
    ).toBe(1)
  }))

test('literal saved presentation escapes command-like data and pointers use selected evidence', async () =>
  fixture(async (root) => {
    await packet(
      root,
      { patch: Buffer.from('diff\n') },
      { output: { message: '\u001b[2J\u202e\n$ jig run binding:evil' } },
    )
    const capture = privateCaptureSavedResult(root)
    try {
      const text = privateSavedResultPlain(capture)
      expect(text).toContain('Selected packet: ' + JSON.stringify(root))
      expect(text).toContain('Local recorded claims')
      expect(text).not.toContain('\u001b[2J')
      expect(text).not.toContain('\u202e')
      expect(Buffer.byteLength(text)).toBeLessThan(32_768)
      const views = privateSavedResultViews(capture)
      for (const view of views) expect(() => validateUserUpdate(view)).not.toThrow()
      expect(views.map((v) => v.title)).toEqual(['Recorded result', 'Files', 'Diagnostics'])
    } finally {
      capture.close()
    }
  }))

function diagnosticViewText(capture: ReturnType<typeof privateCaptureSavedResult>) {
  const view = privateSavedResultViews(capture).find((item) => item.id === 'diagnostics')!
  expect(() => validateUserUpdate(view)).not.toThrow()
  return view.sections
    .flatMap((section) => section.blocks)
    .flatMap((block) => (block.kind === 'report' ? [block.text] : []))
    .join('\n')
}

test('saved diagnostics retain distinct root and child evidence and deduplicate only an exact root', async () =>
  fixture(async (root) => {
    const diagnostics = { stderr: 'ROOT_DIAGNOSTIC', stderrBytes: 15, stderrTruncated: true }
    const child = {
      operations: ['repair', 'patch-1'],
      stderr: 'CHILD_DIAGNOSTIC',
      stderrBytes: 16,
      stderrTruncated: false,
    }
    for (const testCase of [
      { entries: [child], roots: 1, child: true, rootFlag: true },
      {
        entries: [
          { operations: [], stderr: 'DISTINCT_ROOT', stderrBytes: 13, stderrTruncated: false },
          child,
        ],
        roots: 1,
        child: true,
        rootFlag: true,
      },
      {
        entries: [{ operations: [], ...diagnostics }, child],
        roots: 1,
        child: true,
        rootFlag: false,
      },
      {
        entries: [{ operations: [], ...diagnostics, stderrBytes: 16 }],
        roots: 2,
        child: false,
        rootFlag: true,
      },
      {
        entries: [{ operations: [], ...diagnostics, stderrTruncated: false }],
        roots: 2,
        child: false,
        rootFlag: true,
      },
      { entries: [], roots: 1, child: false, rootFlag: true },
    ]) {
      await packet(
        root,
        {},
        {
          status: 'failed',
          code: 'RECORDED_FAILURE',
          message: 'recorded failure',
          diagnostics,
          runDiagnostics: { entries: testCase.entries, truncated: true },
        },
      )
      const capture = privateCaptureSavedResult(root)
      try {
        for (const text of [privateSavedResultPlain(capture), diagnosticViewText(capture)]) {
          expect(text.match(/ROOT_DIAGNOSTIC/g)?.length).toBe(testCase.roots)
          expect(text.includes('CHILD_DIAGNOSTIC')).toBe(testCase.child)
          expect(text.includes('Recorded root capture was truncated.')).toBe(testCase.rootFlag)
          expect(text).toContain('capture was truncated.')
          expect(text).toContain('The recorded diagnostic capture was incomplete.')
          if (testCase.child) expect(text).toContain('Recorded path: repair / patch-1')
          if (testCase.entries.some((entry) => entry.stderr === 'DISTINCT_ROOT'))
            expect(text).toContain('DISTINCT_ROOT')
        }
      } finally {
        capture.close()
      }
    }
  }))

test('saved diagnostic excerpt limits disclose clipping and capture truncation before large text', async () =>
  fixture(async (root) => {
    await packet(
      root,
      {},
      {
        diagnostics: {
          stderr: 'ROOT_DIAGNOSTIC\n' + '\u001b[2J'.repeat(3000),
          stderrBytes: 12_016,
          stderrTruncated: true,
        },
        runDiagnostics: {
          entries: [{ operations: ['child'], stderr: 'CHILD_DIAGNOSTIC', stderrTruncated: true }],
          truncated: true,
        },
      },
    )
    let capture = privateCaptureSavedResult(root)
    try {
      const plain = privateSavedResultPlain(capture)
      const view = diagnosticViewText(capture)
      for (const text of [plain, view]) {
        expect(text).toContain('Recorded root capture was truncated.')
        expect(text).toContain('The recorded diagnostic capture was incomplete.')
        expect(text).toContain('ROOT_DIAGNOSTIC')
        expect(text).toContain('clipped')
      }
      expect(plain).not.toContain('\u001b[2J')
      expect(Buffer.byteLength(plain)).toBeLessThan(32_768)
      expect(Buffer.byteLength(view)).toBeLessThan(9000)
    } finally {
      capture.close()
    }
    const diagnostics = { stderr: 'ROOT_AT_END', stderrBytes: 11, stderrTruncated: false }
    await packet(
      root,
      {},
      {
        diagnostics,
        runDiagnostics: {
          entries: [
            ...Array.from({ length: 32 }, (_, i) => ({
              operations: [`child-${i}`],
              stderr: 'child',
            })),
            { operations: [], ...diagnostics },
          ],
          truncated: false,
        },
      },
    )
    capture = privateCaptureSavedResult(root)
    try {
      for (const text of [privateSavedResultPlain(capture), diagnosticViewText(capture)]) {
        expect(text.match(/ROOT_AT_END/g)?.length).toBe(1)
        expect(text).toContain('Recorded diagnostic entries are omitted')
      }
    } finally {
      capture.close()
    }
  }))

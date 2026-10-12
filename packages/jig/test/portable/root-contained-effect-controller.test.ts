import { dirname as suiteDirname } from 'node:path'

const suiteTestRoot = suiteDirname(import.meta.dir)

import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settleTestCommand } from '.././fixtures/bounded-command.js'

test('an expired retry resolves and releases its prior contained-effect owner first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-contained-controller-'))
  try {
    const child = Bun.spawn(
      [process.execPath, join(suiteTestRoot, 'contained-effect-controller-faults.ts')],
      {
        env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: undefined },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('contained effect deadline/prior-owner ordering checks passed')
    expect(result.stdout).toContain(
      'HTTP actual intent/file-only lowering/failure cleanup checks passed',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('contained-effect phase diagnostics preserve actual controller results and failure cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-contained-profile-'))
  const destination = join(root, 'trace.jsonl')
  try {
    const child = Bun.spawn(
      [process.execPath, join(suiteTestRoot, 'contained-effect-controller-faults.ts')],
      {
        env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: destination },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('contained effect deadline/prior-owner ordering checks passed')
    expect(result.stdout).toContain(
      'HTTP actual intent/file-only lowering/failure cleanup checks passed',
    )
    const text = await readFile(destination, 'utf8')
    expect(text).not.toContain('private-http-intent-test-canary')
    expect(text).not.toContain('private allocation diagnostic canary')
    expect(text).not.toContain('private collection diagnostic canary')
    expect(text).not.toContain('untrusted success')
    expect(text).not.toContain('/protected/owners')
    expect(text).not.toContain('same-operation')
    expect((await stat(destination)).mode & 0o777).toBe(0o600)
    const records = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records[0]).toMatchObject({ kind: 'header', protocol: 'jig-startup-profile/1' })
    const phases = [
      'contained-effect-planning',
      'contained-effect-allocation',
      'contained-effect-sealing',
      'contained-effect-launch',
      'contained-effect-collection',
      'contained-effect-settlement',
    ]
    const starts = new Map<number, any>()
    const seen = new Set<number>()
    const ends: any[] = []
    let previousTime = 0
    for (const line of text.trim().split('\n').slice(1)) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(192)
      const record = JSON.parse(line)
      expect(phases).toContain(record.phase)
      expect(Number.isFinite(record.timeMs)).toBe(true)
      expect(record.timeMs).toBeGreaterThanOrEqual(previousTime)
      previousTime = record.timeMs
      expect(Number.isSafeInteger(record.spanId)).toBe(true)
      expect(record.spanId).toBeGreaterThan(0)
      expect(record.spanId).toBeLessThanOrEqual(512)
      if (record.kind === 'start') {
        expect(Object.keys(record).sort()).toEqual(['kind', 'phase', 'spanId', 'timeMs'])
        expect(seen.has(record.spanId)).toBe(false)
        seen.add(record.spanId)
        starts.set(record.spanId, record)
      } else {
        expect(record.kind).toBe('end')
        expect(Object.keys(record).sort()).toEqual(['kind', 'outcome', 'phase', 'spanId', 'timeMs'])
        const start = starts.get(record.spanId)
        expect(start).toBeDefined()
        expect(record.phase).toBe(start.phase)
        expect(record.timeMs).toBeGreaterThanOrEqual(start.timeMs)
        expect(['returned', 'failed']).toContain(record.outcome)
        starts.delete(record.spanId)
        ends.push(record)
      }
    }
    expect(starts.size).toBe(0)
    expect(new Set(ends.map((record) => record.phase))).toEqual(new Set(phases))
    for (const phase of [
      'contained-effect-allocation',
      'contained-effect-collection',
      'contained-effect-settlement',
    ])
      expect(ends.some((record) => record.phase === phase && record.outcome === 'failed')).toBe(
        true,
      )
    expect(ends.length).toBeLessThanOrEqual(512)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unavailable diagnostic destination cannot replace contained-effect outcomes or cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-contained-profile-refusal-'))
  const destination = join(root, 'occupied.jsonl')
  const retained = 'Existing private diagnostic destination must remain unchanged.'
  try {
    await writeFile(destination, retained, { flag: 'wx', mode: 0o600 })
    const child = Bun.spawn(
      [process.execPath, join(suiteTestRoot, 'contained-effect-controller-faults.ts')],
      {
        env: { ...process.env, JIG_PRIVATE_PROFILE_FILE: destination },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const result = await settleTestCommand(child, {
      evidence: join(root, 'faults'),
      timeoutMs: 15_000,
    })
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('contained effect deadline/prior-owner ordering checks passed')
    expect(result.stdout).toContain(
      'HTTP actual intent/file-only lowering/failure cleanup checks passed',
    )
    expect(result.stderr).toContain('local startup profile capture could not be opened')
    expect(result.stderr).not.toContain(destination)
    expect(result.stderr).not.toContain(retained)
    expect(await readFile(destination, 'utf8')).toBe(retained)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

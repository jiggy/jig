import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import {
  type PrivateAttemptExportOwner,
  parsePrivateExportProcessStat,
  privateAttemptExportOwner,
  privateAttemptExportOwnerGone,
} from '../../src/internal/attempt-export-owner.js'

test('proc stat parsing uses field 22 after the complete parenthesized process name', () => {
  const fields = ['S', ...Array(49).fill('0')]
  fields[19] = '12345'
  expect(parsePrivateExportProcessStat(`42 (odd ) name\n) ${fields.join(' ')}\n`, 42)).toBe('12345')
  expect(() => parsePrivateExportProcessStat(`43 (wrong) ${fields.join(' ')}\n`, 42)).toThrow()
  expect(() => parsePrivateExportProcessStat('42 (short) S 0\n', 42)).toThrow()
  fields[19] = '0'
  expect(() => parsePrivateExportProcessStat(`42 (zero) ${fields.join(' ')}\n`, 42)).toThrow()
})

test('actual live owner identity is not proof of retirement', async () => {
  const owner = privateAttemptExportOwner()
  expect(owner.pid).toBe(process.pid)
  expect(privateAttemptExportOwnerGone(owner)).toBeFalse()
  expect(privateAttemptExportOwnerGone({ ...owner, generation: 'invalid' })).toBeFalse()
  expect(privateAttemptExportOwnerGone({ ...owner, bootId: 'unverifiable' })).toBeFalse()
  if (process.platform === 'linux')
    expect(
      parsePrivateExportProcessStat(
        await readFile(`/proc/${process.pid}/stat`, 'utf8'),
        process.pid,
      ),
    ).toBe(owner.generation)
})

test('real subprocess identity remains owned until the killed process exits', async () => {
  const helper = new URL('../../src/internal/attempt-export-owner.ts', import.meta.url).pathname
  const child = spawn(
    process.execPath,
    [
      '--eval',
      `import {privateAttemptExportOwner} from ${JSON.stringify(helper)}; console.log(JSON.stringify(privateAttemptExportOwner())); setInterval(()=>{},1000);`,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => resolve())
  })
  void exited.catch(() => {})
  try {
    const owner = await new Promise<PrivateAttemptExportOwner>((resolve, reject) => {
      let text = ''
      const timer = setTimeout(() => reject(Error('Owner readiness timed out')), 5000)
      child.stdout.on('data', (bytes) => {
        text += bytes.toString()
        if (text.includes('\n')) {
          clearTimeout(timer)
          resolve(JSON.parse(text.trim()))
        }
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
    expect(owner.pid).toBe(child.pid)
    expect(privateAttemptExportOwnerGone(owner)).toBeFalse()
    expect(child.kill('SIGKILL')).toBeTrue()
    await exited
    expect(child.signalCode).toBe('SIGKILL')
    expect(privateAttemptExportOwnerGone(owner)).toBeTrue()
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  }
}, 15_000)

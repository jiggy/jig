import { describe, expect, test } from 'bun:test'
import { privateHasCoreDumpingProcess } from '../../src/internal/linux-rootless-supervisor.js'

describe('private owned core-dump observation', () => {
  const group = '/sys/fs/cgroup/test/owned'
  const member = '0::/test/owned\n'
  function reader(files: Record<string, string | Error>) {
    const reads: string[] = []
    return {
      reads,
      read: async (path: string) => {
        reads.push(path)
        const value = files[path]
        if (value instanceof Error) throw value
        if (value === undefined) throw Object.assign(new Error('exited'), { code: 'ENOENT' })
        return value
      },
    }
  }
  test('only a core-dumping process still in the exact owner establishes a crash', async () => {
    const fixture = reader({
      [`${group}/cgroup.procs`]: '41\n42\n43\n',
      '/proc/41/status': 'CoreDumping:\t0\n',
      '/proc/42/status': 'CoreDumping:\t1\n',
      '/proc/42/cgroup': '0::/test/sibling\n',
      '/proc/43/status': 'CoreDumping:\t1\n',
      '/proc/43/cgroup': member,
    })
    expect(await privateHasCoreDumpingProcess(group, 3, fixture.read)).toBe(true)
    expect(fixture.reads).not.toContain('/proc/41/cgroup')
  })
  test('disappeared, reused and healthy processes do not establish a crash', async () => {
    const fixture = reader({
      [`${group}/cgroup.procs`]: '41\n42\n43\n',
      '/proc/42/status': 'CoreDumping:\t1\n',
      '/proc/42/cgroup': '0::/test/other\n',
      '/proc/43/status': 'CoreDumping:\t0\nName:\tSegmentation fault\n',
    })
    expect(await privateHasCoreDumpingProcess(group, 3, fixture.read)).toBe(false)
  })
  test('handles an empty owner and a process disappearing during membership recheck', async () => {
    const empty = reader({ [`${group}/cgroup.procs`]: '\n' })
    expect(await privateHasCoreDumpingProcess(group, 1, empty.read)).toBe(false)
    expect(empty.reads).toHaveLength(1)
    const raced = reader({
      [`${group}/cgroup.procs`]: '41\n',
      '/proc/41/status': 'CoreDumping:\t1\n',
      '/proc/41/cgroup': Object.assign(new Error('gone'), { code: 'ESRCH' }),
    })
    expect(await privateHasCoreDumpingProcess(group, 1, raced.read)).toBe(false)
  })
  for (const [suiteCaseIndex, suiteCaseValue] of [
    '41\n42\n',
    '../other\n',
    '0\n',
    '1e2\n',
    '9007199254740992\n',
  ].entries()) {
    test(
      'rejects a malformed or over-budget owned PID list: %s' + ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (pids) => {
            const fixture = reader({ [`${group}/cgroup.procs`]: pids })
            await expect(privateHasCoreDumpingProcess(group, 1, fixture.read)).rejects.toThrow(
              'invalid owned process observation',
            )
            expect(fixture.reads).toHaveLength(1)
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('does not mistake a zombie without CoreDumping for an inspection failure', async () => {
    const fixture = reader({
      [`${group}/cgroup.procs`]: '41\n',
      '/proc/41/status': 'Name:\ttest\nState:\tZ (zombie)\n',
    })
    expect(await privateHasCoreDumpingProcess(group, 1, fixture.read)).toBe(false)
  })
  for (const [suiteCaseIndex, suiteCaseValue] of [
    'CoreDumping:\t2\n',
    'CoreDumping:\n1\n',
    'x'.repeat(65_537),
  ].entries()) {
    test(
      'refuses malformed or oversized kernel observations' + ` (case ${suiteCaseIndex + 1})`,
      () =>
        Reflect.apply(
          async (status) => {
            const fixture = reader({
              [`${group}/cgroup.procs`]: '41\n',
              '/proc/41/status': status,
            })
            await expect(privateHasCoreDumpingProcess(group, 1, fixture.read)).rejects.toThrow()
          },
          undefined,
          Array.isArray(suiteCaseValue) ? suiteCaseValue : [suiteCaseValue],
        ),
    )
  }
  test('does not hide permission or unexpected I/O failures', async () => {
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' })
    const fixture = reader({
      [`${group}/cgroup.procs`]: '41\n',
      '/proc/41/status': denied,
    })
    await expect(privateHasCoreDumpingProcess(group, 1, fixture.read)).rejects.toBe(denied)
  })
})

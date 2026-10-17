import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateHasCoreDumpingProcess } from '../../src/internal/linux-rootless-supervisor.js'

describe('private owned core-dump observation', () => {
  test('refuses an actual directory without a cgroup process observation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jig-missing-cgroup-'))
    try {
      await expect(privateHasCoreDumpingProcess(directory, 1)).rejects.toMatchObject({
        code: 'ENOENT',
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

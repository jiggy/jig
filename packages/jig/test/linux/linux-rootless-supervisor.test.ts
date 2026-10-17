import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PRIVATE_LINUX_EVALUATION_BYTES,
  PRIVATE_LINUX_EVALUATION_FILES,
  privateCopyLinuxEvaluationWorkspace,
} from '../../src/internal/linux-evaluation-workspace.js'
import { privateHasCoreDumpingProcess } from '../../src/internal/linux-rootless-supervisor.js'
import {
  acceptOne,
  type Configuration,
  childClose,
  closeServer,
  collect,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  expectMissing,
  type Fixture,
  fixtureFor,
  invokeSupervisor,
  listen,
  OWNER_TOKEN,
  POLICY,
  SUPERVISOR,
  withTimeout,
  writeOwner,
} from '.././linux-rootless-supervisor.fixture.js'

describe('trusted Linux evaluator copy', () => {
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'jig-evaluation-copy-'))
    const source = join(root, 'source'),
      target = join(root, 'target')
    await mkdir(source)
    await mkdir(target)
    return { root, source, target }
  }
  async function dispose(f: Awaited<ReturnType<typeof fixture>>) {
    await chmod(f.source, 0o700)
    try {
      await chmod(join(f.source, 'src'), 0o700)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rm(f.root, { recursive: true, force: true })
  }
  test('copies regular bytes and authentic empty directories without changing source', async () => {
    const f = await fixture()
    try {
      await mkdir(join(f.source, 'src'))
      await writeFile(join(f.source, 'src/code.ts'), 'export default 1')
      await chmod(join(f.source, 'src/code.ts'), 0o444)
      await chmod(join(f.source, 'src'), 0o555)
      await chmod(f.source, 0o555)
      privateCopyLinuxEvaluationWorkspace(
        { phase: 'compile', emptyDirectories: ['src/empty/deep'] },
        f.source,
        f.target,
      )
      expect(await readFile(join(f.target, 'src/code.ts'), 'utf8')).toBe('export default 1')
      expect(await readdir(join(f.target, 'src/empty/deep'))).toEqual([])
      expect(await readdir(join(f.source, 'src'))).toEqual(['code.ts'])
      expect((await readdir(f.target)).sort()).toEqual([
        'dist',
        'generated',
        'reports',
        'scratch',
        'src',
      ])
      expect(PRIVATE_LINUX_EVALUATION_BYTES).toBe(192 * 1024 * 1024)
      expect(PRIVATE_LINUX_EVALUATION_FILES).toBe(8448)
    } finally {
      await dispose(f)
    }
  })
  for (const kind of ['symlink', 'hardlink', 'writable', 'current-output', 'oversized'] as const) {
    test(`refuses ${kind} source before projection`, async () => {
      const f = await fixture()
      try {
        const path = join(f.source, kind === 'current-output' ? 'dist' : 'file')
        if (kind === 'symlink') await symlink('/etc/passwd', path)
        else {
          await writeFile(path, 'data')
          if (kind === 'hardlink') await link(path, join(f.root, 'alias'))
          if (kind === 'oversized') await truncate(path, PRIVATE_LINUX_EVALUATION_BYTES + 1)
          if (kind !== 'writable') await chmod(path, 0o444)
        }
        await chmod(f.source, 0o555)
        expect(() =>
          privateCopyLinuxEvaluationWorkspace(
            { phase: 'compile', emptyDirectories: [] },
            f.source,
            f.target,
          ),
        ).toThrow()
        expect(await readdir(f.target)).toEqual([])
      } finally {
        await dispose(f)
      }
    })
  }
  test('rejects empty-directory file collisions', async () => {
    const f = await fixture()
    try {
      await writeFile(join(f.source, 'file'), 'data', { mode: 0o444 })
      await chmod(f.source, 0o555)
      expect(() =>
        privateCopyLinuxEvaluationWorkspace(
          { phase: 'test', emptyDirectories: ['file/child'] },
          f.source,
          f.target,
        ),
      ).toThrow()
    } finally {
      await dispose(f)
    }
  })
  test('metadata cannot populate a fresh phase output root', async () => {
    const f = await fixture()
    try {
      await chmod(f.source, 0o555)
      expect(() =>
        privateCopyLinuxEvaluationWorkspace(
          { phase: 'compile', emptyDirectories: ['dist/empty'] },
          f.source,
          f.target,
        ),
      ).toThrow()
    } finally {
      await dispose(f)
    }
  })
  test('accepts the complete 8448-file envelope and rejects one extra regular file', async () => {
    const f = await fixture()
    try {
      for (let index = 0; index < PRIVATE_LINUX_EVALUATION_FILES; index++)
        await writeFile(join(f.source, `file-${index}`), '', { mode: 0o444 })
      await chmod(f.source, 0o555)
      privateCopyLinuxEvaluationWorkspace(
        { phase: 'compile', emptyDirectories: [] },
        f.source,
        f.target,
      )
      expect((await readdir(f.target)).length).toBe(PRIVATE_LINUX_EVALUATION_FILES + 4)
      await chmod(f.source, 0o700)
      await writeFile(join(f.source, 'overflow'), '', { mode: 0o444 })
      await chmod(f.source, 0o555)
      const overflow = join(f.root, 'overflow')
      await mkdir(overflow)
      expect(() =>
        privateCopyLinuxEvaluationWorkspace(
          { phase: 'compile', emptyDirectories: [] },
          f.source,
          overflow,
        ),
      ).toThrow('bound')
    } finally {
      await dispose(f)
    }
  }, 30_000)
  test('counts implicit empty-directory parents against the sealed 256-entry bound', async () => {
    const f = await fixture()
    try {
      await chmod(f.source, 0o555)
      expect(() =>
        privateCopyLinuxEvaluationWorkspace(
          {
            phase: 'compile',
            emptyDirectories: Array.from(
              { length: 129 },
              (_, index) => `root-${String(index).padStart(3, '0')}/empty`,
            ),
          },
          f.source,
          f.target,
        ),
      ).toThrow('metadata exceeds bound')
    } finally {
      await dispose(f)
    }
  })
})

describe('private rootless Linux supervisor admission boundary', () => {
  test('exits when its coordinator connects but never sends a start message', async () => {
    const fixture = await fixtureFor('missing-start')
    try {
      const result = await invokeSupervisor(fixture.configuration, [], {
        sendStart: false,
        startupTimeoutMs: 50,
      })

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: '',
        stdout: '',
      })
      expect(result.stderr).toContain('rootless supervisor start timed out')
      await expectMissing(join(fixture.ownerStateDirectory, 'claim.json'))
      await expectMissing(fixture.runCgroup)
      await expectMissing(fixture.marker)
    } finally {
      await fixture.dispose()
    }
  })
  test('rejects a malformed limit before claiming or creating a cgroup', async () => {
    const fixture = await fixtureFor('invalid-limit')
    try {
      await writeOwner(fixture, fixture.configuration)
      const malformed = {
        ...fixture.configuration,
        limits: {
          ...fixture.configuration.limits,
          memoryBytes: 'max',
        },
      }

      const result = await invokeSupervisor(malformed)

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: '',
        stdout: '',
      })
      expect(result.stderr).toContain('invalid rootless supervisor configuration')
      await expectMissing(join(fixture.ownerStateDirectory, 'claim.json'))
      await expectMissing(fixture.runCgroup)
      await expectMissing(fixture.marker)
    } finally {
      await fixture.dispose()
    }
  })
  test('rejects configuration which does not match its durable owner', async () => {
    const fixture = await fixtureFor('owner-mismatch')
    try {
      await writeOwner(fixture, {
        ...fixture.configuration,
        ownerDigest: DIGEST_C,
      })

      const result = await invokeSupervisor(fixture.configuration)

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: '',
        stdout: '',
      })
      expect(result.stderr).toContain('rootless owner-state record is invalid')
      await expectMissing(join(fixture.ownerStateDirectory, 'claim.json'))
      await expectMissing(fixture.runCgroup)
      await expectMissing(fixture.marker)
    } finally {
      await fixture.dispose()
    }
  })
  test('an existing active claim rejects a duplicate launch before mutation', async () => {
    const fixture = await fixtureFor('duplicate-active')
    try {
      await writeOwner(fixture, fixture.configuration)
      const claim = {
        allocationDigest: fixture.configuration.ownerStateAllocationDigest,
        kind: 'private-linux-owner-claim/1',
        state: 'active',
        token: fixture.configuration.ownerToken,
      }
      await writeFile(
        join(fixture.ownerStateDirectory, 'claim.json'),
        `${JSON.stringify(claim)}\n`,
        { mode: 0o600 },
      )

      // Queue admission as well as the start. A broken claim guard therefore
      // cannot pass merely because the test withheld permission to execute.
      const result = await invokeSupervisor(fixture.configuration, [{ type: 'admit' }])

      expect(result).toMatchObject({
        code: 70,
        signal: null,
        control: '',
        stdout: '',
      })
      expect(result.stderr).toContain('rootless owner claim is already active')
      expect(
        JSON.parse(await readFile(join(fixture.ownerStateDirectory, 'claim.json'), 'utf8')),
      ).toEqual(claim)
      await expectMissing(fixture.runCgroup)
      await expectMissing(fixture.marker)
    } finally {
      await fixture.dispose()
    }
  })
})

if (process.platform !== 'linux') throw Error('This suite requires Linux')

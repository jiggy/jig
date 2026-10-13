import { describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { privateHasCoreDumpingProcess } from '../../src/internal/linux-rootless-supervisor.js'
import {
  POLICY,
  SUPERVISOR,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  OWNER_TOKEN,
  fixtureFor,
  writeOwner,
  invokeSupervisor,
  expectMissing,
  listen,
  acceptOne,
  childClose,
  withTimeout,
  collect,
  closeServer,
  type Configuration,
  type Fixture,
} from '.././linux-rootless-supervisor.fixture.js'

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

import { describe, expect, test } from 'bun:test'
import { constants } from 'node:fs'

import {
  acquirePrivateRootlessLinux,
  PrivateRootlessLinuxAcquisitionError,
  revalidatePrivateRootlessLinux,
  type PrivateRootlessLinuxAcquisitionDependencies,
} from '../src/internal/linux-rootless-acquisition.js'

const ROOT = '/sys/fs/cgroup'
const CURRENT = `${ROOT}/user.slice/session.scope/payload`
const DELEGATED = `${ROOT}/user.slice/session.scope`
const BWRAP = '/immutable/bubblewrap-0.12.0/bin/bwrap'

describe('private rootless Linux acquisition', () => {
  test('validates an exact operator-selected Bubblewrap and rejects later selection drift', async () => {
    const fixture = validFixture()
    let selected = BWRAP
    const dependencies = { ...fixture.dependencies, bubblewrapPath: () => selected }
    const retained = await acquirePrivateRootlessLinux(dependencies)
    expect(retained.bubblewrapPath).toBe(BWRAP)
    expect(fixture.executions).toHaveLength(2)
    expect(fixture.resolved).not.toContain('/usr/bin/bwrap')
    fixture.version = '0.11.0'
    await expect(revalidatePrivateRootlessLinux(retained, [], dependencies)).rejects.toBeInstanceOf(
      PrivateRootlessLinuxAcquisitionError,
    )
    fixture.version = '0.12.0'
    fixture.information.set(BWRAP, file(1_000, 0o4755))
    await expect(acquirePrivateRootlessLinux(dependencies)).rejects.toBeInstanceOf(
      PrivateRootlessLinuxAcquisitionError,
    )
    fixture.information.set(BWRAP, file(1_000, 0o755))
    selected = '/another/bwrap'
    fixture.information.set(selected, file(1_000, 0o755))
    await expect(revalidatePrivateRootlessLinux(retained, [], dependencies)).rejects.toBeInstanceOf(
      PrivateRootlessLinuxAcquisitionError,
    )
  })

  for (const selected of ['', 'bwrap', './bwrap', '/invalid\0bwrap', '/missing/bwrap']) {
    test(`does not fall back from an invalid explicit Bubblewrap path ${JSON.stringify(selected)}`, async () => {
      const fixture = validFixture()
      await expect(
        acquirePrivateRootlessLinux({
          ...fixture.dependencies,
          bubblewrapPath: () => selected,
        }),
      ).rejects.toBeInstanceOf(PrivateRootlessLinuxAcquisitionError)
      expect(fixture.executions).toHaveLength(0)
      expect(fixture.resolved).not.toContain('/usr/bin/bwrap')
    })
  }

  test('applies the same feature and authority checks to NixOS Bubblewrap', async () => {
    const fixture = validFixture()
    const dependencies = {
      ...fixture.dependencies,
      resolve: async (path: string) => {
        if (path === '/usr/bin/bwrap' || path === '/bin/bwrap') {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        if (path === '/run/current-system/sw/bin/bwrap') return BWRAP
        return fixture.dependencies.resolve(path)
      },
    }
    const retained = await acquirePrivateRootlessLinux(dependencies)
    expect(retained.bubblewrapPath).toBe(BWRAP)
    expect(fixture.executions).toHaveLength(2)
    fixture.version = '0.11.0'
    await expect(revalidatePrivateRootlessLinux(retained, [], dependencies)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
    fixture.version = '0.12.0'
    fixture.information.set(BWRAP, file(1_000, 0o4755))
    await expect(acquirePrivateRootlessLinux(dependencies)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
  })

  test("derives only the current cgroup's exclusive immediate parent", async () => {
    const fixture = validFixture()
    const observation = await acquirePrivateRootlessLinux(fixture.dependencies)

    expect(observation).toEqual({
      kind: 'private-rootless-linux-acquisition/1',
      delegatedCgroup: DELEGATED,
      currentCgroup: CURRENT,
      bubblewrapPath: BWRAP,
      bubblewrapVersion: '0.12.0',
      payloadUid: 1_000,
      payloadGid: 100,
    })
    expect(Object.isFrozen(observation)).toBe(true)
    expect(fixture.resolved).toEqual([CURRENT, DELEGATED, '/usr/bin/bwrap'])
    expect(fixture.executions).toHaveLength(2)
    expect(fixture.executions[0]).toEqual({ path: BWRAP, arguments: ['--version'] })
    expect(fixture.executions[1]!.path).toBe(BWRAP)
    expect(fixture.executions[1]!.arguments).toContain('--unshare-all')
    expect(fixture.executions[1]!.arguments).toContain('--assert-userns-disabled')
    expect(fixture.executions[1]!.arguments.slice(-3)).toEqual(['--', BWRAP, '--version'])
    expect(fixture.accesses).toContainEqual({
      path: `${CURRENT}/cgroup.kill`,
      mode: constants.W_OK,
    })
  })

  for (const [label, mutate] of [
    [
      'non-cgroup-v2 filesystem',
      (fixture: Fixture) => {
        fixture.filesystemType = 0x0102_1994
      },
    ],
    [
      'ambiguous cgroup membership',
      (fixture: Fixture) => {
        fixture.text.set('/proc/self/cgroup', '0::/one\n1:name=/two\n')
      },
    ],
    [
      'cgroup namespace root',
      (fixture: Fixture) => {
        fixture.text.set('/proc/self/cgroup', '0::/payload\n')
      },
    ],
    [
      'owner mismatch',
      (fixture: Fixture) => {
        fixture.information.set(DELEGATED, directory(0))
      },
    ],
    [
      'populated parent',
      (fixture: Fixture) => {
        fixture.text.set(`${DELEGATED}/cgroup.procs`, '99\n')
      },
    ],
    [
      'sibling cgroup',
      (fixture: Fixture) => {
        fixture.directories.set(DELEGATED, ['payload', 'unrelated'])
      },
    ],
    [
      'missing controller',
      (fixture: Fixture) => {
        fixture.text.set(`${DELEGATED}/cgroup.subtree_control`, 'cpu memory\n')
      },
    ],
    [
      'missing control file',
      (fixture: Fixture) => {
        fixture.denied.add(`${CURRENT}/pids.max`)
      },
    ],
    [
      'setuid Bubblewrap',
      (fixture: Fixture) => {
        fixture.information.set(BWRAP, file(1_000, 0o4755))
      },
    ],
    [
      'old Bubblewrap',
      (fixture: Fixture) => {
        fixture.version = '0.11.0'
      },
    ],
    [
      'failed Bubblewrap feature probe',
      (fixture: Fixture) => {
        fixture.featureFailure = new Error('kernel exposed a private host detail')
      },
    ],
  ] as const) {
    test(`fails closed for ${label}`, async () => {
      const fixture = validFixture()
      mutate(fixture)
      const failure = await acquirePrivateRootlessLinux(fixture.dependencies).then(
        () => undefined,
        (error) => error,
      )

      expect(failure).toBeInstanceOf(PrivateRootlessLinuxAcquisitionError)
      expect(failure).toMatchObject({
        code: 'SANDBOX_UNAVAILABLE',
        message: 'the required rootless Linux sandbox is unavailable',
      })
      expect(String(failure)).not.toContain('kernel exposed')
      expect(String(failure)).not.toContain(DELEGATED)
    })
  }

  test('never searches a usable grandparent when the immediate parent is invalid', async () => {
    const fixture = validFixture()
    fixture.text.set(`${DELEGATED}/cgroup.procs`, '77\n')
    const grandparent = `${ROOT}/user.slice`
    fixture.text.set(`${grandparent}/cgroup.procs`, '')
    fixture.text.set(`${grandparent}/cgroup.controllers`, 'cpu memory pids\n')
    fixture.text.set(`${grandparent}/cgroup.subtree_control`, 'cpu memory pids\n')
    fixture.information.set(grandparent, directory(1_000))
    fixture.directories.set(grandparent, ['session.scope'])

    await expect(acquirePrivateRootlessLinux(fixture.dependencies)).rejects.toMatchObject({
      code: 'SANDBOX_UNAVAILABLE',
    })
    expect(fixture.reads).not.toContain(`${grandparent}/cgroup.procs`)
    expect(fixture.reads).not.toContain(`${grandparent}/cgroup.controllers`)
    expect(fixture.reads).not.toContain(`${grandparent}/cgroup.subtree_control`)
  })

  test('revalidates only the retained authority and exact active Run children', async () => {
    const fixture = validFixture()
    const retained = await acquirePrivateRootlessLinux(fixture.dependencies)
    const active = `${DELEGATED}/jig-run-root-one-${'a'.repeat(24)}`
    fixture.directories.set(DELEGATED, ['payload', active.slice(DELEGATED.length + 1)])

    expect(
      await revalidatePrivateRootlessLinux(retained, Object.freeze([active]), fixture.dependencies),
    ).toEqual(retained)
    await expect(
      revalidatePrivateRootlessLinux(retained, [], fixture.dependencies),
    ).rejects.toBeInstanceOf(PrivateRootlessLinuxAcquisitionError)

    fixture.directories.set(DELEGATED, ['payload', active.slice(DELEGATED.length + 1), 'unrelated'])
    await expect(
      revalidatePrivateRootlessLinux(retained, [active], fixture.dependencies),
    ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' })
  })

  test('rejects retained authority and support drift', async () => {
    const fixture = validFixture()
    const retained = await acquirePrivateRootlessLinux(fixture.dependencies)

    fixture.text.set('/proc/self/cgroup', '0::/user.slice/other.scope/payload\n')
    await expect(
      revalidatePrivateRootlessLinux(retained, [], fixture.dependencies),
    ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' })

    fixture.text.set('/proc/self/cgroup', '0::/user.slice/session.scope/payload\n')
    fixture.version = '0.13.0'
    await expect(
      revalidatePrivateRootlessLinux(retained, [], fixture.dependencies),
    ).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' })
  })
})

interface Fixture {
  filesystemType: number | bigint
  version: string
  featureFailure?: Error
  readonly text: Map<string, string>
  readonly directories: Map<string, readonly string[]>
  readonly information: Map<string, ReturnType<typeof directory>>
  readonly denied: Set<string>
  readonly reads: string[]
  readonly resolved: string[]
  readonly accesses: Array<{ readonly path: string; readonly mode: number }>
  readonly executions: Array<{ readonly path: string; readonly arguments: readonly string[] }>
  readonly dependencies: PrivateRootlessLinuxAcquisitionDependencies
}

function validFixture(): Fixture {
  const fixture = {
    filesystemType: 0x6367_7270n,
    version: '0.12.0',
    text: new Map<string, string>([
      ['/proc/self/cgroup', '0::/user.slice/session.scope/payload\n'],
      [`${DELEGATED}/cgroup.procs`, ''],
      [`${DELEGATED}/cgroup.controllers`, 'cpu io memory pids\n'],
      [`${DELEGATED}/cgroup.subtree_control`, 'cpu memory pids\n'],
    ]),
    directories: new Map<string, readonly string[]>([[DELEGATED, ['payload']]]),
    information: new Map<string, ReturnType<typeof directory>>([
      [CURRENT, directory(1_000)],
      [DELEGATED, directory(1_000)],
      [BWRAP, file(1_000, 0o755)],
    ]),
    denied: new Set<string>(),
    reads: [] as string[],
    resolved: [] as string[],
    accesses: [] as Array<{ readonly path: string; readonly mode: number }>,
    executions: [] as Array<{ readonly path: string; readonly arguments: readonly string[] }>,
  } as Fixture
  fixture.dependencies = Object.freeze({
    uid: () => 1_000,
    gid: () => 100,
    readText: async (path) => {
      fixture.reads.push(path)
      const value = fixture.text.get(path)
      if (value === undefined) throw new Error(`missing fixture text ${path}`)
      return value
    },
    listDirectories: async (path) => {
      const value = fixture.directories.get(path)
      if (value === undefined) throw new Error(`missing fixture directory ${path}`)
      return value
    },
    information: async (path) => {
      const value = fixture.information.get(path)
      if (value === undefined) throw new Error(`missing fixture information ${path}`)
      return value
    },
    filesystemType: async () => fixture.filesystemType,
    resolve: async (path) => {
      fixture.resolved.push(path)
      return path === '/usr/bin/bwrap' ? BWRAP : path
    },
    requireAccess: async (path, mode) => {
      fixture.accesses.push({ path, mode })
      if (fixture.denied.has(path)) throw new Error(`fixture denied ${path}`)
    },
    execute: async (path, arguments_) => {
      fixture.executions.push({ path, arguments: Object.freeze([...arguments_]) })
      if (arguments_.length === 1 && arguments_[0] === '--version') {
        return { stdout: `bubblewrap ${fixture.version}\n`, stderr: '' }
      }
      if (fixture.featureFailure !== undefined) throw fixture.featureFailure
      return { stdout: `bubblewrap ${fixture.version}\n`, stderr: '' }
    },
  })
  return fixture
}

function directory(uid: number): {
  readonly uid: number
  readonly mode: number
  isDirectory(): true
  isFile(): false
} {
  return { uid, mode: 0o755, isDirectory: () => true, isFile: () => false }
}

function file(uid: number, mode: number): ReturnType<typeof directory> {
  return { uid, mode, isDirectory: () => false, isFile: () => true } as never
}

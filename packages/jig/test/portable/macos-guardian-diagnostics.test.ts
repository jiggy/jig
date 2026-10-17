import { expect, test } from 'bun:test'
import {
  normalizePrivateMacosGuardianFailure,
  type PrivateMacosGuardianRecoveryDiagnostic,
  privateMacosGuardianFailure,
  reportPrivateMacosGuardianRecovery,
  withPrivateMacosGuardianDiagnostics,
} from '../../src/internal/macos-guardian-diagnostics.js'

test('guardian failure transport keeps only closed steps and causes', () => {
  const clock = privateMacosGuardianFailure(
    'scope-preparation',
    new Error('macOS guardian native clock unavailable'),
  )
  expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(clock)))).toEqual({
    step: 'scope-preparation',
    cause: 'NATIVE_CLOCK',
  })
  const privateError = Object.assign(new Error('private-token /private/owner/path'), {
    code: 'PRIVATE_TOKEN',
    cause: new Error('credential'),
  })
  expect(privateMacosGuardianFailure('scope-preparation', privateError)).toEqual({
    step: 'scope-preparation',
    cause: 'OTHER',
  })
  const unreadable = Object.defineProperty(new Error(), 'message', {
    get() {
      throw new Error('private getter must not interrupt cleanup')
    },
  })
  expect(privateMacosGuardianFailure('storage', unreadable)).toEqual({
    step: 'storage',
    cause: 'OTHER',
  })
  const failure = privateMacosGuardianFailure(
    'storage',
    new Error('macOS volume attach failed', { cause: privateError }),
  )
  expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(failure)))).toEqual({
    step: 'storage',
    cause: 'VOLUME_ATTACH',
  })
  expect(Object.isFrozen(failure)).toBe(true)
  expect(normalizePrivateMacosGuardianFailure(null)).toBeNull()
  expect(JSON.stringify(failure)).not.toContain('private-token')
  for (const [message, cause] of [
    ['macOS image attachment owner does not match its allocation', 'VOLUME_IMAGE_OWNER'],
    ['macOS volume device does not match its allocation', 'VOLUME_DEVICE'],
  ]) {
    const evidence = privateMacosGuardianFailure('storage-recovery', new Error(message))
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(evidence)))).toEqual({
      step: 'storage-recovery',
      cause,
    })
  }
  for (const value of [
    undefined,
    'private-token',
    [],
    { step: 'private-token', cause: 'OTHER' },
    { step: 'storage', cause: 'private-token' },
    { step: 'storage', cause: 'OTHER', message: 'private-token' },
    { step: ['storage'], cause: 'OTHER' },
    { step: 'storage', cause: ['VOLUME_ATTACH'] },
  ])
    expect(() => normalizePrivateMacosGuardianFailure(value)).toThrow(
      'invalid macOS guardian response',
    )
})
test('guardian recovery evidence distinguishes lost control from terminal cleanup without raw errors', () => {
  const events: PrivateMacosGuardianRecoveryDiagnostic[] = []
  withPrivateMacosGuardianDiagnostics(
    (event) => events.push(event),
    () => {
      reportPrivateMacosGuardianRecovery(
        'running',
        'receive',
        new Error('macOS control channel ended'),
      )
      reportPrivateMacosGuardianRecovery(
        'terminal',
        'terminal-cleanup',
        new Error('macOS guardian job removal is unconfirmed'),
      )
      reportPrivateMacosGuardianRecovery(
        'collecting',
        'output-transfer',
        Object.assign(new Error('private-token /private/owner/path'), {
          code: 'PRIVATE_TOKEN',
          cause: 'secret',
        }),
      )
    },
  )
  expect(events).toEqual([
    { phase: 'running', step: 'receive', cause: 'CONTROL_EOF' },
    { phase: 'terminal', step: 'terminal-cleanup', cause: 'JOB_REMOVAL_UNCONFIRMED' },
    { phase: 'collecting', step: 'output-transfer', cause: 'OTHER' },
  ])
  expect(events.every(Object.isFrozen)).toBe(true)
})
test('guardian diagnostic observers are isolated across asynchronous invocations', async () => {
  const first: PrivateMacosGuardianRecoveryDiagnostic[] = []
  const second: PrivateMacosGuardianRecoveryDiagnostic[] = []
  await Promise.all([
    withPrivateMacosGuardianDiagnostics(
      (event) => first.push(event),
      async () => {
        await Bun.sleep(10)
        reportPrivateMacosGuardianRecovery(
          'running',
          'receive',
          new Error('macOS control channel ended'),
        )
      },
    ),
    withPrivateMacosGuardianDiagnostics(
      (event) => second.push(event),
      async () => {
        await Bun.sleep(1)
        reportPrivateMacosGuardianRecovery(
          'collecting',
          'validate',
          new Error('invalid macOS guardian response'),
        )
      },
    ),
  ])
  reportPrivateMacosGuardianRecovery('prepared', 'receive', new Error('not observed'))
  expect(first).toEqual([{ phase: 'running', step: 'receive', cause: 'CONTROL_EOF' }])
  expect(second).toEqual([{ phase: 'collecting', step: 'validate', cause: 'INVALID_RESPONSE' }])
})
test('a broken observer cannot replace execution or recovery results', async () => {
  expect(
    await withPrivateMacosGuardianDiagnostics(
      () => {
        throw new Error('observer failed')
      },
      async () => {
        await Bun.sleep(1)
        reportPrivateMacosGuardianRecovery(
          'running',
          'receive',
          new Error('macOS control channel ended'),
        )
        return 'original result'
      },
    ),
  ).toBe('original result')
})

test('storage recovery literal refusals survive the exact private transport without raw causes', () => {
  const refusals = [
    ['macOS volume capacity is outside its finite profile', 'VOLUME_CAPACITY'],
    ['macOS volume requires a canonical private path', 'VOLUME_PATH'],
    ['macOS volume directory is aliased', 'VOLUME_DIRECTORY_ALIAS'],
    ['macOS volume directory is not private', 'VOLUME_DIRECTORY_PRIVATE'],
    ['macOS volume directory identity changed', 'VOLUME_DIRECTORY_IDENTITY'],
    ['invalid macOS volume ownership token', 'VOLUME_TOKEN'],
    ['macOS volume journal is unsafe', 'VOLUME_JOURNAL_UNSAFE'],
    ['macOS volume journal changed', 'VOLUME_JOURNAL_CHANGED'],
    ['macOS volume ownership authentication failed', 'VOLUME_AUTHENTICATION'],
    ['invalid macOS volume allocation', 'VOLUME_ALLOCATION'],
    ['macOS image inventory is invalid', 'VOLUME_INVENTORY'],
    ['macOS volume control directory changed', 'VOLUME_CONTROL_IDENTITY'],
    ['macOS volume backing journal is invalid', 'VOLUME_BACKING_JOURNAL'],
    ['macOS volume backing identity changed', 'VOLUME_BACKING_IDENTITY'],
    ['macOS attached image has no authenticated backing', 'VOLUME_ATTACHED_BACKING_MISSING'],
    ['macOS volume backing changed before detach', 'VOLUME_BACKING_DETACH_IDENTITY'],
    ['macOS volume mount allocation changed', 'VOLUME_MOUNT_IDENTITY'],
    ['macOS volume backing changed before removal', 'VOLUME_BACKING_REMOVE_IDENTITY'],
    ['macOS recovery tools are not fenced', 'RECOVERY_TOOLS_UNFENCED'],
  ] as const
  for (const [message, cause] of refusals) {
    const original = Object.assign(
      new Error(message, { cause: new Error('secret-token private-path') }),
      {
        privateValue: 'credential-canary',
      },
    )
    const failure = privateMacosGuardianFailure('storage-recovery', original)
    expect(failure).toEqual({ step: 'storage-recovery', cause })
    expect(Object.isFrozen(failure)).toBe(true)
    expect(Object.keys(failure).sort()).toEqual(['cause', 'step'])
    const encoded = JSON.stringify(failure)
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(encoded))).toEqual(failure)
    expect(encoded).not.toContain(message)
    expect(encoded).not.toContain('secret-token')
    expect(encoded).not.toContain('private-path')
    expect(encoded).not.toContain('credential-canary')
    for (const near of [
      message + ' secret-token',
      'private-path ' + message,
      message.toUpperCase(),
    ])
      expect(privateMacosGuardianFailure('storage-recovery', new Error(near)).cause).toBe('OTHER')
  }
})

test('filesystem and abort evidence uses only fixed categories, never arbitrary native fields', () => {
  const categories = [
    ['ENOENT', 'FILESYSTEM_MISSING'],
    ['EBUSY', 'FILESYSTEM_BUSY'],
    ['ENOTEMPTY', 'FILESYSTEM_NOT_EMPTY'],
    ['EIO', 'FILESYSTEM_IO'],
    ['EACCES', 'FILESYSTEM_ACCESS'],
    ['EPERM', 'FILESYSTEM_PERMISSION'],
    ['ENOSPC', 'FILESYSTEM_FULL'],
    ['EROFS', 'FILESYSTEM_READ_ONLY'],
  ] as const
  for (const [code, cause] of categories) {
    const error = Object.assign(
      new Error('credential-canary /private/owner/token', {
        cause: new Error('private nested data'),
      }),
      {
        code,
        errno: -999,
        path: '/private/secret',
        syscall: 'secret-syscall',
        name: 'private-class',
      },
    )
    const failure = privateMacosGuardianFailure('storage-recovery', error)
    expect(failure).toEqual({ step: 'storage-recovery', cause })
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(failure)))).toEqual(
      failure,
    )
    expect(JSON.stringify(failure)).not.toMatch(/credential|private|secret|999/)
  }
  for (const error of [
    Object.assign(new Error('private Node abort'), { name: 'AbortError', code: 'ABORT_ERR' }),
    new DOMException('private DOM abort', 'AbortError'),
  ]) {
    const failure = privateMacosGuardianFailure('storage-recovery', error)
    expect(failure).toEqual({ step: 'storage-recovery', cause: 'ABORTED' })
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(failure)))).toEqual(
      failure,
    )
    expect(JSON.stringify(failure)).not.toMatch(/private|Node|DOM/)
  }
  for (const code of [
    'SECRET_CANARY',
    'ENOENT ',
    'enoent',
    'ABORT_ERR',
    'AbortError',
    -2,
    null,
    ['ENOENT'],
  ])
    expect(
      privateMacosGuardianFailure('storage-recovery', Object.assign(new Error('private'), { code }))
        .cause,
    ).toBe('OTHER')
  for (const error of [
    Object.assign(new Error('private'), { name: 'AbortError' }),
    new DOMException('private', 'TimeoutError'),
    { code: 'ENOENT', name: 'AbortError', message: 'private' },
    'private',
  ])
    expect(privateMacosGuardianFailure('storage-recovery', error).cause).toBe('OTHER')
  // Exact owning errors take precedence over a nested or unrelated native code.
  expect(
    privateMacosGuardianFailure(
      'storage-recovery',
      Object.assign(new Error('macOS attached image has no authenticated backing'), {
        code: 'ENOENT',
      }),
    ).cause,
  ).toBe('VOLUME_ATTACHED_BACKING_MISSING')
})

test('unknown and unreadable diagnostic fields cannot widen the closed recovery vocabulary', () => {
  for (const field of ['message', 'code', 'name']) {
    const error = Object.defineProperty(new Error('unknown private failure'), field, {
      get() {
        throw new Error('private getter must not escape')
      },
    })
    expect(privateMacosGuardianFailure('storage-recovery', error)).toEqual({
      step: 'storage-recovery',
      cause: 'OTHER',
    })
  }
  for (const cause of [
    'FILESYSTEM_MISSING secret-token',
    'filesystem_missing',
    'ABORTED ',
    'VOLUME_BACKING_IDENTITY/private-token',
    'EIO',
    ['ABORTED'],
  ])
    expect(() => normalizePrivateMacosGuardianFailure({ step: 'storage-recovery', cause })).toThrow(
      'invalid macOS guardian response',
    )
  expect(() =>
    normalizePrivateMacosGuardianFailure({
      step: 'storage-recovery',
      cause: 'FILESYSTEM_IO',
      path: 'private-token',
    }),
  ).toThrow('invalid macOS guardian response')
})

test('new recovery diagnostics preserve the original result or exact thrown error with a broken observer', async () => {
  const events: PrivateMacosGuardianRecoveryDiagnostic[] = []
  const original = Object.assign(new Error('private original failure'), { code: 'EBUSY' })
  await withPrivateMacosGuardianDiagnostics(
    (event) => events.push(event),
    async () => {
      reportPrivateMacosGuardianRecovery('admitted', 'terminal-cleanup', original)
    },
  )
  expect(events).toEqual([
    { phase: 'admitted', step: 'terminal-cleanup', cause: 'FILESYSTEM_BUSY' },
  ])
  expect(Object.isFrozen(events[0])).toBe(true)
  let caught: unknown
  try {
    await withPrivateMacosGuardianDiagnostics(
      () => {
        throw new Error('private observer')
      },
      async () => {
        reportPrivateMacosGuardianRecovery('admitted', 'terminal-cleanup', original)
        throw original
      },
    )
  } catch (error) {
    caught = error
  }
  expect(caught).toBe(original)
  expect(
    await withPrivateMacosGuardianDiagnostics(
      () => {
        throw new Error('private observer')
      },
      async () => {
        reportPrivateMacosGuardianRecovery('admitted', 'terminal-cleanup', original)
        return 'unchanged original result'
      },
    ),
  ).toBe('unchanged original result')
})

test('image mapping subcauses retain exact closed transport and never replace the original error', async () => {
  const refusals = [
    ['macOS image attachment count does not match its allocation', 'VOLUME_IMAGE_COUNT'],
    ['macOS image attachment owner does not match its allocation', 'VOLUME_IMAGE_OWNER'],
    [
      'macOS image attachment sector size does not match its allocation',
      'VOLUME_IMAGE_SECTOR_SIZE',
    ],
    [
      'macOS image attachment sector count does not match its allocation',
      'VOLUME_IMAGE_SECTOR_COUNT',
    ],
    ['macOS image attachment encryption does not match its allocation', 'VOLUME_IMAGE_ENCRYPTION'],
    ['macOS image attachment entities do not match its allocation', 'VOLUME_IMAGE_ENTITIES'],
  ] as const
  for (const [message, cause] of refusals) {
    const original = Object.assign(
      new Error(message, { cause: new Error('image-secret-token /private/image-path') }),
      { path: '/private/control', device: '/dev/private-disk', metadata: 'image-secret-token' },
    )
    const failure = privateMacosGuardianFailure('storage-recovery', original)
    expect(failure).toEqual({ step: 'storage-recovery', cause })
    expect(Object.isFrozen(failure)).toBe(true)
    expect(Object.keys(failure).sort()).toEqual(['cause', 'step'])
    const encoded = JSON.stringify(failure)
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(encoded))).toEqual(failure)
    expect(encoded).not.toMatch(/image-secret-token|private|device|metadata/)
    expect(encoded).not.toContain(message)
    for (const near of [
      message + ' image-secret-token',
      'private ' + message,
      message.toUpperCase(),
    ])
      expect(privateMacosGuardianFailure('storage-recovery', new Error(near)).cause).toBe('OTHER')
    for (const near of [cause + ' image-secret-token', cause.toLowerCase(), cause + '/private'])
      expect(() =>
        normalizePrivateMacosGuardianFailure({ step: 'storage-recovery', cause: near }),
      ).toThrow('invalid macOS guardian response')
    const events: PrivateMacosGuardianRecoveryDiagnostic[] = []
    withPrivateMacosGuardianDiagnostics(
      (event) => events.push(event),
      () => reportPrivateMacosGuardianRecovery('admitted', 'validate', original),
    )
    expect(events).toEqual([{ phase: 'admitted', step: 'validate', cause }])
    expect(Object.isFrozen(events[0])).toBe(true)
    expect(JSON.stringify(events)).not.toMatch(/image-secret-token|private|device|metadata/)
    let caught: unknown
    try {
      await withPrivateMacosGuardianDiagnostics(
        () => {
          throw new Error('image-secret-token observer failure')
        },
        async () => {
          reportPrivateMacosGuardianRecovery('admitted', 'validate', original)
          throw original
        },
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(original)
  }
})

test('scope preparation preserves closed causes after fenced cleanup without raw evidence', () => {
  const refusals = [
    ['macOS scope is not initially empty', 'SCOPE_NOT_EMPTY'],
    ['invalid macOS scope limits', 'SCOPE_LIMITS'],
    ['invalid macOS native launch', 'SCOPE_LAUNCH'],
    ['macOS working directory is outside its directory projections', 'SCOPE_CWD'],
    ['macOS initial accounting is incomplete', 'SCOPE_INITIAL_ACCOUNTING'],
    ['macOS launch handoffs are unavailable', 'SCOPE_HANDOFFS'],
    ['macOS descendant fencing is unconfirmed', 'SCOPE_FENCING'],
    ['macOS final resource accounting is unconfirmed', 'SCOPE_FINAL_ACCOUNTING'],
    ['macOS scope ended before readiness (payload_exit)', 'SCOPE_EARLY_EXIT'],
    ['macOS scope ended before readiness (cancelled)', 'SCOPE_CANCELLED'],
    ['macOS scope ended before readiness (coordinator_lost)', 'SCOPE_COORDINATOR_LOST'],
    ['macOS scope ended before readiness (deadline)', 'SCOPE_DEADLINE'],
    ['macOS scope ended before readiness (setup_failed)', 'SCOPE_SETUP_FAILED'],
    ['macOS scope ended before readiness (memory_limit)', 'SCOPE_MEMORY_LIMIT'],
    ['macOS scope ended before readiness (process_limit)', 'SCOPE_PROCESS_LIMIT'],
    ['macOS scope ended before readiness (cpu_limit)', 'SCOPE_CPU_LIMIT'],
    ['macOS scope ended before readiness (accounting_failed)', 'SCOPE_ACCOUNTING_FAILED'],
  ] as const
  for (const [message, cause] of refusals) {
    const original = new Error(message, {
      cause: new Error('private-path credential-canary exit 255'),
    })
    const failure = privateMacosGuardianFailure('scope-preparation', original)
    expect(failure).toEqual({ step: 'scope-preparation', cause })
    expect(normalizePrivateMacosGuardianFailure(JSON.parse(JSON.stringify(failure)))).toEqual(
      failure,
    )
    expect(JSON.stringify(failure)).not.toMatch(/private|credential|255/)
    for (const near of [message + ' private-path', message.toUpperCase()])
      expect(privateMacosGuardianFailure('scope-preparation', new Error(near)).cause).toBe('OTHER')
  }
})

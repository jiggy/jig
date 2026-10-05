import { expect, test } from 'bun:test'
import {
  normalizePrivateMacosGuardianFailure,
  type PrivateMacosGuardianRecoveryDiagnostic,
  privateMacosGuardianFailure,
  reportPrivateMacosGuardianRecovery,
  withPrivateMacosGuardianDiagnostics,
} from '../src/internal/macos-guardian-diagnostics.js'

test('guardian failure transport keeps only closed steps and causes', () => {
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

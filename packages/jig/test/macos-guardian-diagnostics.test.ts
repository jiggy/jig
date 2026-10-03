import { expect, test } from 'bun:test'
import {
  type PrivateMacosGuardianRecoveryDiagnostic,
  reportPrivateMacosGuardianRecovery,
  withPrivateMacosGuardianDiagnostics,
} from '../src/internal/macos-guardian-diagnostics.js'

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

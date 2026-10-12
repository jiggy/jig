import { expect, test } from 'bun:test'
import {
  privateContainedDeadlineBeforeDispatchMessage,
  privateContainedDeadlineLimit,
  privateContainedDeadlineMessage,
  privateContainedWorkerDeadlineMessage,
} from '../src/internal/root-contained-effect-controller.js'

test('deadline diagnostics identify the binding limit without guessing effect completion', () => {
  expect(privateContainedDeadlineLimit('http', 50, 60, 70)).toBe('root Run')
  expect(privateContainedDeadlineLimit('command', 60, 50, 70)).toBe('parent Flow')
  expect(privateContainedDeadlineLimit('http', 70, 60, 50)).toBe('HTTP grant')
  expect(privateContainedDeadlineLimit('command', 70, 60, 50)).toBe('project command')
  expect(privateContainedDeadlineLimit('http', 50, 50, 50)).toBe('root Run')

  const message = privateContainedDeadlineMessage(
    'http',
    'root Run',
    'collecting the worker result',
  )
  expect(message).toContain('HTTP request')
  expect(message).toContain('limited by root Run')
  expect(message).toContain('effects may have occurred')
  expect(message).not.toContain('request was not sent')

  expect(privateContainedWorkerDeadlineMessage('http', 'HTTP grant')).toContain(
    'worker stopped at its effective deadline',
  )
  expect(privateContainedWorkerDeadlineMessage('http', 'HTTP grant')).toContain(
    'remote effects may have occurred',
  )
  expect(privateContainedWorkerDeadlineMessage('command', 'project command')).toContain(
    'cleanup completed but no successful command result was proved',
  )
})

test('pre-dispatch deadline diagnostics distinguish effects that never started', () => {
  const message = privateContainedDeadlineBeforeDispatchMessage('command', 'parent Flow')
  expect(message).toContain('project command did not start')
  expect(message).toContain('limited by parent Flow')
  expect(message).toContain('it was not dispatched')
  expect(message).not.toContain('effects may have occurred')
})

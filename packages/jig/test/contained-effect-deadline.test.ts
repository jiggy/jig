import { expect, test } from 'bun:test'
import {
  privateContainedDeadlineLimit,
  privateContainedDeadlineMessage,
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
})

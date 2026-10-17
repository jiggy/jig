import { expect, test } from 'bun:test'
import { privateCliCommandLifetimeMs } from '../../src/cli.js'

test('web lifetime depends on terminal stderr; machine selection wins', () => {
  const args = ['run', 'flow:flows/work', '--display', 'web']
  expect(privateCliCommandLifetimeMs(args, false, true)).toBeNull()
  expect(privateCliCommandLifetimeMs(args, true, false)).toBe(330000)
  for (const mode of [['--json'], ['--receive', 'progress']])
    expect(privateCliCommandLifetimeMs([...args, ...mode], false, true)).toBe(330000)
})

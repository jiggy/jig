import { expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main, privateCliRequiresHost, privateCliVerification } from '../../src/cli.js'
import { completionScript } from '../../src/cli-discovery.js'
import { parsePrivateExploreArguments } from '../../src/cli-explore.js'
import { privateExploreHandoff } from '../../src/cli-explore-launch.js'

test('explore selects an exact optional target and ordinary per-Run policy without acquiring a host', () => {
  expect(parsePrivateExploreArguments(['explore'])).toEqual({ timeoutMs: 30_000 })
  expect(
    parsePrivateExploreArguments([
      'explore',
      'binding:repair',
      '--timeout',
      '2m',
      '--verification',
      'strict',
    ]),
  ).toEqual({
    target: 'binding:repair',
    timeoutMs: 120_000,
    verification: 'strict',
  })
  expect(privateCliRequiresHost(['explore', 'binding:repair'])).toBe(false)
  expect(privateCliVerification(['explore', '--verification', 'fast'])).toBe('fast')
  for (const arguments_ of [
    ['explore', '--input', '{}'],
    ['explore', '--attach', 'input=/tmp'],
    ['explore', '--out', '/tmp/result'],
    ['explore', '--timeout', '0s'],
    ['explore', '--timeout', '25h'],
    ['explore', '--timeout', '1s', '--timeout', '2s'],
    ['explore', '--verification', 'none'],
    ['explore', '--verification'],
    ['explore', 'binding:a', 'binding:b'],
  ])
    expect(() => parsePrivateExploreArguments(arguments_)).toThrow()
})

test('explore help and redirected refusal preserve an untouched ordinary project directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jig-explore-help-'))
  try {
    const output: string[] = []
    const errors: string[] = []
    const options = {
      currentDirectory: directory,
      terminalOutput: false,
      terminalError: false,
      writeOutput: (text: string) => {
        output.push(text)
      },
      writeError: (text: string) => {
        errors.push(text)
      },
    }
    expect(await main(['explore', '--help'], options)).toBe(0)
    expect(output.join('')).toContain('No workflow starts merely by opening the explorer')
    expect(output.join('')).toContain('Close explorer or Ctrl-C stops active work')
    expect(await main(['explore'], options)).toBe(1)
    expect(errors.join('')).toContain('terminal stderr')
    expect(await readdir(directory)).toEqual([])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('shell completion exposes explore and exact approved target lookup', () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    const source = completionScript(shell)!
    expect(source).toContain('explore')
    expect(source).toContain('jig completion targets')
  }
})

test('installed handoff accepts only a closed numeric-loopback destination and private capability', () => {
  expect(privateExploreHandoff({})).toBeUndefined()
  expect(
    privateExploreHandoff({
      JIG_PRIVATE_EXPLORE_HANDOFF: JSON.stringify({
        url: 'http://127.0.0.1:12345/internal/run',
        capability: 'a'.repeat(43),
      }),
    }),
  ).toBeDefined()
  for (const url of [
    'http://localhost:12345/internal/run',
    'http://127.0.0.1:65536/internal/run',
    'http://127.0.0.1:12345/internal/run?token=secret',
    'http://127.0.0.1:12345/api/run',
    'https://example.com/internal/run',
  ])
    expect(() =>
      privateExploreHandoff({
        JIG_PRIVATE_EXPLORE_HANDOFF: JSON.stringify({ url, capability: 'a'.repeat(43) }),
      }),
    ).toThrow('Explorer handoff is unavailable')
  expect(() =>
    privateExploreHandoff({
      JIG_PRIVATE_EXPLORE_HANDOFF: JSON.stringify({
        url: 'http://127.0.0.1:12345/internal/run',
        capability: 'a'.repeat(43),
        input: {},
      }),
    }),
  ).toThrow('Explorer handoff is unavailable')
})

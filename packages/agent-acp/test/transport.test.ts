import { describe, expect, test } from 'bun:test'
import {
  FINITE_ACP_LIMITS,
  FiniteAcpFrames,
  fragmentFiniteAcpFrame,
  readFiniteAcpReady,
} from '../src/transport.js'

describe('finite ACP framing', () => {
  test('round-trips large text and supplementary scalars without exceeding channel items', () => {
    const text = JSON.stringify({ text: '\u0001\\"😀é'.repeat(90_000) })
    const fragments = [...fragmentFiniteAcpFrame(text)]
    expect(fragments.length).toBeGreaterThan(1)
    const frames = new FiniteAcpFrames('requests')
    const results: string[] = []
    for (const fragment of fragments) {
      expect(Buffer.byteLength(fragment.text)).toBeLessThanOrEqual(8_192)
      expect(Buffer.byteLength(JSON.stringify(fragment))).toBeLessThanOrEqual(65_536)
      expect(fragment.text.isWellFormed()).toBe(true)
      const result = frames.accept(fragment)
      if (result !== undefined) results.push(result)
    }
    frames.finish()
    expect(results).toEqual([text])
    expect(() => frames.accept(fragments[0])).toThrow('not open')
  })

  test('rejects invalid fragments and stays poisoned after the caller catches failure', () => {
    for (const value of [
      null,
      [],
      {},
      { kind: 'data', text: '', end: true },
      { kind: 'data', text: 'x', end: 0 },
      { kind: 'data', text: 'x', end: true, id: 'replay' },
      { kind: 'data', text: '\ud800', end: true },
      { kind: 'data', text: 'x'.repeat(8_193), end: true },
    ]) {
      const frames = new FiniteAcpFrames('responses')
      expect(() => frames.accept(value)).toThrow()
      expect(() => frames.accept({ kind: 'data', text: '{}', end: true })).toThrow('not open')
      expect(() => frames.finish()).toThrow('not open')
    }
  })

  test('EOF inside a frame fails; a complete empty stream does not assert protocol settlement', () => {
    const partial = new FiniteAcpFrames('requests')
    partial.accept({ kind: 'data', text: '{', end: false })
    expect(() => partial.finish()).toThrow('inside a frame')
    new FiniteAcpFrames('requests').finish()
    expect(() => [...fragmentFiniteAcpFrame('')]).toThrow()
    expect(() => [...fragmentFiniteAcpFrame('\udc00')]).toThrow()
  })

  test('bounds aggregate request bytes even when complete frames are individually valid', () => {
    const reader = new FiniteAcpFrames('requests')
    for (let count = 0; count < FINITE_ACP_LIMITS.requestBytes / 8_192; count++)
      reader.accept({ kind: 'data', text: 'x'.repeat(8_192), end: false })
    expect(() => reader.accept({ kind: 'data', text: 'x', end: true })).toThrow('bounds')
  })

  test('bounds complete request count and one response frame', () => {
    const requests = new FiniteAcpFrames('requests')
    for (let count = 0; count < FINITE_ACP_LIMITS.requestFrames; count++)
      requests.accept({ kind: 'data', text: '{}', end: true })
    expect(() => requests.accept({ kind: 'data', text: '{}', end: true })).toThrow(
      'too many frames',
    )
    const responses = new FiniteAcpFrames('responses')
    for (let count = 0; count < FINITE_ACP_LIMITS.frameBytes / 8_192; count++)
      responses.accept({ kind: 'data', text: 'x'.repeat(8_192), end: false })
    expect(() => responses.accept({ kind: 'data', text: 'x', end: true })).toThrow('bounds')
  })
})

describe('reviewed ready record', () => {
  test('snapshots configuration without allowing later model replacement', () => {
    const input = {
      kind: 'ready',
      protocolVersion: 1,
      cwd: '/work',
      maxTurns: 1,
      configuration: [{ configId: 'model', value: 'reviewed' }],
      modeId: 'read-only',
    }
    const ready = readFiniteAcpReady(input)
    input.configuration[0]!.value = 'other'
    expect(ready.configuration[0]!.value).toBe('reviewed')
    expect(Object.isFrozen(ready.configuration)).toBe(true)
    expect(Object.isFrozen(ready.configuration[0])).toBe(true)
    expect(
      readFiniteAcpReady({ ...input, restoreSessionId: 'owned-session' }).restoreSessionId,
    ).toBe('owned-session')
    expect(
      readFiniteAcpReady({
        ...input,
        configuration: [{ configId: 'compaction', type: 'boolean', value: false }],
      }).configuration,
    ).toEqual([{ configId: 'compaction', type: 'boolean', value: false }])
  })

  test('rejects extra authority, malformed or duplicate configuration, and accessors', () => {
    const base = { kind: 'ready', protocolVersion: 1, cwd: '/work', maxTurns: 1, configuration: [] }
    for (const value of [
      { ...base, cwd: '/' },
      { ...base, protocolVersion: 2 },
      { ...base, token: 'secret' },
      { ...base, modeId: null },
      ...[null, '', 'x\0y', 'x'.repeat(1_025)].map((restoreSessionId) => ({
        ...base,
        restoreSessionId,
      })),
      { ...base, configuration: [{ configId: 'model', value: 'x', type: 'string' }] },
      {
        ...base,
        configuration: [
          { configId: 'x', value: '1' },
          { configId: 'x', value: '2' },
        ],
      },
      { ...base, configuration: new Array(17).fill({ configId: 'x', value: 'y' }) },
    ])
      expect(() => readFiniteAcpReady(value)).toThrow()
    let invoked = false
    const accessor = {
      ...base,
      get modeId() {
        invoked = true
        return 'bad'
      },
    }
    expect(() => readFiniteAcpReady(accessor)).toThrow('data properties')
    expect(invoked).toBe(false)
  })
})

import { describe, expect, test } from 'bun:test'
import { Artifacts, parseCallResult } from '../src/artifacts.js'
import { encodeJson } from '../src/json.js'
import { parseRunParams } from '../src/protocol.js'

describe('finite artifact projection', () => {
  test('projects only held opaque identities, forwards without paths and never resurrects a released grant', () => {
    const owner = new Artifacts()
    const other = new Artifacts()
    const wire = { outcome: 'done', output: null, artifacts: { files: 'artifact:1' } }
    const artifact = owner.result(parseCallResult(wire)).artifacts!.files!
    expect(artifact).not.toHaveProperty('path')
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(owner.result(wire).artifacts!.files).toBe(artifact)
    expect(() => other.mappings({ source: { read: artifact } })).toThrow()
    expect(() => owner.mappings({ source: { read: { ...artifact } } })).toThrow()
    expect(() => encodeJson(artifact as never)).toThrow()
    expect(owner.mappings({ source: { read: artifact }, files: { create: true } })).toEqual({
      source: { read: 'artifact:1' },
      files: { create: true },
    })
    expect(
      owner.terminal({ outcome: 'blocked', output: null, artifactResults: { final: artifact } }),
    ).toEqual({
      outcome: 'blocked',
      output: null,
      artifactResults: { final: 'artifact:1' },
    })
    owner.retire(artifact.reference)
    expect(owner.result(wire).artifacts!.files).toBe(artifact)
    expect(owner.mappings({ source: { read: artifact } })).toEqual({
      source: { read: 'artifact:1' },
    })
    expect(() =>
      owner.terminal({ outcome: 'done', output: null, artifactResults: { final: artifact } }),
    ).toThrow()
  })

  test('rejects malformed maps, active fields, token bounds and mixed result envelopes', () => {
    const owner = new Artifacts()
    for (const raw of [
      null,
      [],
      'bad',
      { files: { create: false } },
      { files: { create: true, path: '/host' } },
      { 'bad-name\n': { create: true } },
    ])
      expect(() => owner.mappings(raw as never)).toThrow()
    let read = false
    expect(() =>
      owner.mappings({
        files: Object.defineProperty({}, 'create', {
          enumerable: true,
          get() {
            read = true
            return true
          },
        }),
      } as never),
    ).toThrow()
    expect(read).toBe(false)
    for (const ref of ['', 'x'.repeat(129), 'x\n', '/path', 'é'])
      expect(() =>
        parseCallResult({ outcome: 'done', output: null, artifacts: { files: ref } }),
      ).toThrow()
    for (const artifacts of [null, [], { 'bad\n': 'a:1' }, { files: { reference: 'a:1' } }])
      expect(() => parseCallResult({ outcome: 'done', output: null, artifacts } as never)).toThrow()
    expect(() => parseCallResult({ outcome: 'done', output: null, artifactResults: {} })).toThrow()
    expect(() =>
      owner.terminal({ outcome: 'done', output: null, artifacts: {} } as never),
    ).toThrow()
  })

  test('initial readonly attachment grants can be delegated; writable attachment grants reject', () => {
    const params = {
      protocol: 'run/0',
      input: null,
      settings: {},
      scratch: '/scratch',
      deadlineUnixMs: 1,
      attachments: { source: { path: '/sandbox/source', access: 'read', artifact: 'source:1' } },
    }
    const parsed = parseRunParams(params)
    const owner = new Artifacts()
    const artifact = owner.incoming(parsed.attachments).source!.artifact!
    expect(owner.mappings({ source: { read: artifact } })).toEqual({ source: { read: 'source:1' } })
    expect(() =>
      parseRunParams({
        ...params,
        attachments: { out: { path: '/out', access: 'read-write', artifact: 'bad:1' } },
      }),
    ).toThrow()
  })
})

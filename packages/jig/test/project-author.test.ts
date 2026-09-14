import { describe, expect, test } from 'bun:test'

import { defineBinding, defineJig, discover } from '../src/index.js'
import { normalizeJigDefinition, normalizePackageBindingDefinition } from '../src/project/author.js'

describe('Jig project authoring SDK/1', () => {
  test('captures discovery and exact membership', () => {
    const project = defineJig({
      flows: discover(['./vendor', './flows']),
      bindings: ['./bindings/z.ts', './bindings/a.ts'],
    })
    expect(project).toEqual({
      flows: { kind: 'discover', roots: ['flows', 'vendor'] },
      bindings: { kind: 'members', paths: ['bindings/a.ts', 'bindings/z.ts'] },
    })
    expect(Object.isFrozen(project)).toBeTrue()
    expect(Object.isFrozen(project.flows)).toBeTrue()
    expect(normalizeJigDefinition(project)).toEqual(project)
    expect(() => defineJig(project as never)).toThrow()
  })

  test('captures one package Binding with structural defaults', () => {
    const binding = defineBinding({
      package: './flows/review',
      settings: { maxRetries: 4 },
    })
    expect(binding).toEqual({
      kind: 'package',
      package: 'flows/review',
      settings: { maxRetries: 4 },
      slots: {},
    })
    expect(normalizePackageBindingDefinition(binding)).toEqual(binding)
    expect(defineBinding({ package: './flows/review' })).toEqual({
      kind: 'package',
      package: 'flows/review',
      settings: {},
      slots: {},
    })
    expect(() => defineBinding(binding as never)).toThrow()
  })

  test('captures canonical default target selections without resolving their contracts', () => {
    const defaultProviders = {
      'https://example.org/review': 'flow:./flows/reviewer',
      'https://jig.md/contracts/agent-run': 'binding:agent',
    }
    const project = defineJig({ defaultProviders })
    defaultProviders['https://example.org/review'] = 'binding:changed'
    expect(project).toEqual({
      defaultProviders: {
        'https://example.org/review': 'flow:flows/reviewer',
        'https://jig.md/contracts/agent-run': 'binding:agent',
      },
    })
    expect(Object.isFrozen(project.defaultProviders)).toBeTrue()
    expect(normalizeJigDefinition(project)).toEqual(project)
    expect(defineJig({ defaultProviders: {} })).toEqual({ defaultProviders: {} })
    expect(defineJig({})).toEqual({})
  })

  test('accepts the bounded default-selection limit', () => {
    const defaultProviders = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [
        `https://example.org/worker-${index}`,
        `binding:worker-${index}`,
      ]),
    )
    expect(Object.keys(defineJig({ defaultProviders }).defaultProviders!)).toHaveLength(256)
  })

  test('captures exact child Flow and Binding selectors', () => {
    const slots = { question: 'flow:./flows/answer-question', bug: 'binding:handle-bug' }
    const binding = defineBinding({ package: './flows/router', slots })
    slots.bug = 'binding:changed'
    expect(binding.slots).toEqual({
      bug: 'binding:handle-bug',
      question: 'flow:flows/answer-question',
    })
    expect(Object.keys(binding.slots)).toEqual(['bug', 'question'])
    expect(Object.isFrozen(binding.slots)).toBeTrue()
    expect(normalizePackageBindingDefinition(binding)).toEqual(binding)
  })

  for (const [name, action] of [
    ['unknown project field', () => defineJig({ extra: true } as never)],
    ['undefined optional', () => defineJig({ flows: undefined } as never)],
    ['undefined providers', () => defineJig({ defaultProviders: undefined } as never)],
    ['non-map providers', () => defineJig({ defaultProviders: ['binding:agent'] } as never)],
    ['non-string provider', () => defineJig({ defaultProviders: { contract: 3 } } as never)],
    ['plain provider path', () => defineJig({ defaultProviders: { contract: 'flows/agent' } })],
    ['provider grant', () => defineJig({ defaultProviders: { contract: 'grant:agent' } })],
    ['native provider', () => defineJig({ defaultProviders: { contract: 'agent:worker' } })],
    [
      'invalid provider Binding',
      () => defineJig({ defaultProviders: { contract: 'binding:Bad' } }),
    ],
    [
      'escaping provider path',
      () => defineJig({ defaultProviders: { contract: 'flow:../agent' } }),
    ],
    [
      'spoofed default target',
      () =>
        defineJig({ defaultProviders: { contract: { kind: 'binding', id: 'agent' } } } as never),
    ],
    [
      'oversized defaults',
      () =>
        defineJig({
          defaultProviders: Object.fromEntries(
            Array.from({ length: 257 }, (_, index) => [
              `https://example.org/worker-${index}`,
              `binding:worker-${index}`,
            ]),
          ),
        }),
    ],
    ['empty discovery', () => discover([])],
    ['glob root', () => discover('./flows/*')],
    ['escaping package', () => defineBinding({ package: '../flow' })],
    ['unknown Binding field', () => defineBinding({ package: 'flows/a', grants: {} } as never)],
    [
      'non-path attachments',
      () => defineBinding({ package: 'flows/a', attachments: { source: 3 } } as never),
    ],
    [
      'invalid slot name',
      () => defineBinding({ package: 'flows/a', slots: { Bad: 'flow:flows/b' } }),
    ],
    [
      'invalid slot path',
      () => defineBinding({ package: 'flows/a', slots: { child: 'flow:../flow' } }),
    ],
    ['plain slot path', () => defineBinding({ package: 'flows/a', slots: { child: 'flows/b' } })],
    [
      'invalid Binding selector',
      () => defineBinding({ package: 'flows/a', slots: { child: 'binding:Bad' } }),
    ],
    [
      'unknown selector',
      () => defineBinding({ package: 'flows/a', slots: { child: 'agent:worker' } }),
    ],
    [
      'non-string slot path',
      () => defineBinding({ package: 'flows/a', slots: { child: 1 } as never }),
    ],
    ['non-object slots', () => defineBinding({ package: 'flows/a', slots: [] as never })],
    [
      'oversized slots',
      () =>
        defineBinding({
          package: 'flows/a',
          slots: Object.fromEntries(
            Array.from({ length: 257 }, (_, index) => [`slot-${index}`, 'flow:flows/b']),
          ),
        }),
    ],
    [
      'non-JSON settings',
      () => defineBinding({ package: 'flows/a', settings: { bad: 1n } as never }),
    ],
    ['class settings', () => defineBinding({ package: 'flows/a', settings: new (class {})() })],
  ] as const) {
    test(`rejects ${name}`, () => expect(action).toThrow())
  }

  test('takes one deeply frozen settings snapshot', () => {
    const settings = { nested: { enabled: true } }
    const binding = defineBinding({ package: 'flows/a', settings })
    settings.nested.enabled = false
    expect(binding.settings).toEqual({ nested: { enabled: true } })
    expect(Object.isFrozen(binding.settings.nested)).toBeTrue()
  })

  test('rejects accessor-backed and nonordinary default selections without invoking them', () => {
    let invoked = false
    const accessor = Object.defineProperty({}, 'contract', {
      get() {
        invoked = true
        return 'binding:changed'
      },
      enumerable: true,
    })
    const extended = { contract: 'binding:agent', extra: true }
    class Providers {
      contract = 'binding:agent'
    }
    for (const defaultProviders of [accessor, new Array(1), extended, new Providers()]) {
      expect(() => defineJig({ defaultProviders } as never)).toThrow()
      expect(() => normalizeJigDefinition({ defaultProviders })).toThrow()
    }
    expect(invoked).toBeFalse()
  })

  test('preserves prototype-sensitive JSON member names', () => {
    const settings = JSON.parse('{"__proto__":{"safe":true},"constructor":"data","prototype":null}')
    const binding = defineBinding({ package: 'flows/a', settings })
    expect(Object.keys(binding.settings)).toEqual(['__proto__', 'constructor', 'prototype'])
    expect(Object.getPrototypeOf(binding.settings)).toBeNull()
    expect(binding.settings.__proto__).toEqual({ safe: true })
  })

  test('rejects accessors, cycles, sparse arrays, and extended objects', () => {
    let invoked = false
    const accessor = Object.defineProperty({}, 'value', {
      get() {
        invoked = true
        return 'unsafe'
      },
      enumerable: true,
    })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const value of [
      accessor,
      cycle,
      { value: new Date(0) },
      { value: new Array(1) },
      { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: '\ud800' },
    ]) {
      expect(() => defineBinding({ package: 'flows/a', settings: value as never })).toThrow()
    }
    expect(invoked).toBeFalse()
  })

  test('allows matcher characters only in exact paths', () => {
    expect(defineBinding({ package: 'flows/[draft]' }).package).toBe('flows/[draft]')
    expect(() => discover('flows/[draft]')).toThrow()
  })

  test('rejects path collisions and independent path limits', () => {
    expect(() => defineJig({ flows: ['flows/Review', 'flows/review'] })).toThrow()
    expect(() => defineBinding({ package: `${'a/'.repeat(64)}z` })).toThrow('64 segments')
    expect(() => defineBinding({ package: `flows/${'a'.repeat(256)}` })).toThrow('255 UTF-8 bytes')
    expect(() => defineBinding({ package: `flows/${'é'.repeat(510)}` })).toThrow('1024 UTF-8 bytes')
  })
})

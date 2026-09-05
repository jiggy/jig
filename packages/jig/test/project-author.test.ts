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
    ['empty discovery', () => discover([])],
    ['glob root', () => discover('./flows/*')],
    ['escaping package', () => defineBinding({ package: '../flow' })],
    ['unknown Binding field', () => defineBinding({ package: 'flows/a', grants: {} } as never)],
    [
      'unsupported attachments',
      () => defineBinding({ package: 'flows/a', attachments: {} } as never),
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

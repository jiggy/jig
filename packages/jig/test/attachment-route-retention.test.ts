import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { defineBinding, defineJig } from '../src/index.js'
import {
  decodePrivateProjectLocalLock,
  encodePrivateProjectLocalLock,
  privateProjectLocalLockDigest,
} from '../src/internal/project-local-lock.js'
import { canonicalJson, type JsonValue } from '../src/json.js'
import { normalizePackageBindingDefinition } from '../src/project/author.js'
import {
  flowSlotTargets,
  normalizeInvocationSlots,
  resolveInvocationSlots,
} from '../src/project/invocation-slots.js'
import { compileSchemaFile } from '../src/schema/index.js'

const digest = `sha256:${'a'.repeat(64)}`
const attachments = {
  source: { from: 'originals' },
  files: { into: 'photos', directory: 'copies' },
}
const mappedRoute = {
  kind: 'route',
  target: { kind: 'flow', path: 'flows/child' },
  attachments,
}
const lockValue = {
  packages: {
    'flows/parent': { digest, directRun: false, uses: { copy: {} } },
    'flows/child': { digest, directRun: true, uses: {} },
  },
  bindings: {
    parent: {
      packagePath: 'flows/parent',
      settings: {},
      slots: { copy: mappedRoute },
    },
  },
}

function decode(value: unknown) {
  const body = canonicalJson(value as JsonValue)
  const bytes = new Uint8Array(body.length + 1)
  bytes.set(body)
  bytes[body.length] = 10
  return decodePrivateProjectLocalLock(bytes)
}

test('explicit Binding maps preserve complete review data through author normalization', () => {
  const input = { target: 'flow:./flows/child', attachments: structuredClone(attachments) }
  const binding = defineBinding({ package: 'flows/parent', slots: { copy: input } })
  input.attachments.source.from = 'changed'
  expect(binding.slots.copy).toEqual({ target: 'flow:flows/child', attachments })
  expect(normalizePackageBindingDefinition(binding)).toEqual(binding)
  expect(Object.isFrozen(binding.slots.copy)).toBe(true)
  for (const target of ['binding:child', 'npm:@example/child']) {
    expect(
      defineBinding({ package: 'flows/parent', slots: { copy: { target, attachments } } }).slots
        .copy,
    ).toEqual({ target, attachments })
  }
  for (const route of [
    { target: 'grant:worker', attachments },
    { target: 'agent:worker', attachments },
    { target: 'flow:flows/child', attachments, grant: {} },
    { target: 'flow:flows/child' },
    { attachments },
    { target: 'flow:flows/child', attachments: {} },
  ]) {
    expect(() =>
      defineBinding({ package: 'flows/parent', slots: { copy: route } } as never),
    ).toThrow()
  }
  expect(() =>
    defineJig({
      defaultProviders: {
        'https://example.org/child': { target: 'flow:flows/child', attachments },
      },
    } as never),
  ).toThrow()
  expect(() =>
    defineBinding({
      package: 'flows/parent',
      slots: {
        copy: { target: 'flow:flows/child', attachments },
        other: {
          target: 'binding:child',
          attachments: { files: { into: 'reports', directory: 'copies' } },
        },
      },
    }),
  ).toThrow('duplicate')
})

test('the sealed declaration SDK bundles child maps without host module imports', async () => {
  const bundle = await Bun.build({
    entrypoints: [new URL('../src/project/evaluator-sdk-entry.ts', import.meta.url).pathname],
    target: 'bun',
    format: 'esm',
    write: false,
    plugins: [
      {
        name: 'sealed-author-sdk-no-host-imports',
        setup(builder) {
          builder.onResolve({ filter: /^node:/ }, ({ path }) => {
            throw new Error(`sealed declaration SDK cannot import host module ${path}`)
          })
        },
      },
    ],
  })
  expect(bundle.success, bundle.logs.map((log) => log.message).join('\n')).toBe(true)
  expect(bundle.outputs.length).toBe(1)
  const compiled = await bundle.outputs[0]!.text()
  expect(compiled).toContain('normalizeBindingAttachmentMap')
  expect(compiled).not.toMatch(/(?:from\s*|require\()\s*["']node:/)
})

test('retained routes preserve maps while target lookup remains exact ordinary identity', () => {
  const slots = resolveInvocationSlots({ copy: {} }, { copy: mappedRoute } as never)
  expect(slots.copy).toEqual({ kind: 'flow', target: mappedRoute.target, attachments })
  expect(normalizeInvocationSlots(slots)).toEqual(slots)
  expect(flowSlotTargets(slots)).toEqual({ copy: mappedRoute.target })
  const wrong = structuredClone(slots) as any
  wrong.copy.attachments.files.directory = 'overview'
  expect(canonicalJson(wrong)).not.toEqual(canonicalJson(slots as unknown as JsonValue))
  for (const replacement of [
    { ...slots.copy, attachments: {} },
    { ...slots.copy, attachments: { source: { from: 'originals', path: 'somewhere' } } },
    { ...slots.copy, mappingDigest: digest },
    { ...slots.copy, target: { kind: 'grant', policy: { kind: 'command', run: 'index.ts' } } },
  ])
    expect(() => normalizeInvocationSlots({ copy: replacement })).toThrow()
})

test('lock route round trip retains maps, identities and every reviewed change', () => {
  const lock = decode(lockValue)
  expect(lock.bindings.parent!.slots.copy).toEqual(mappedRoute)
  expect(decodePrivateProjectLocalLock(encodePrivateProjectLocalLock(lock))).toEqual(lock)
  const before = privateProjectLocalLockDigest(lock)
  for (const mutate of [
    (value: any) => {
      value.bindings.parent.slots.copy.attachments.source.from = 'reference'
    },
    (value: any) => {
      value.bindings.parent.slots.copy.attachments.files.into = 'reports'
    },
    (value: any) => {
      value.bindings.parent.slots.copy.attachments.files.directory = 'overview'
    },
  ]) {
    const value = structuredClone(lockValue)
    mutate(value)
    expect(privateProjectLocalLockDigest(decode(value))).not.toBe(before)
  }
  const reordered = structuredClone(lockValue)
  reordered.bindings.parent.slots.copy.attachments = {
    files: attachments.files,
    source: attachments.source,
  }
  expect(privateProjectLocalLockDigest(decode(reordered))).toBe(before)
})

test('lock routes refuse widened targets, duplicates, bare defaults and bound child resources', () => {
  for (const mutate of [
    (value: any) => {
      value.bindings.parent.slots.copy.mappingDigest = digest
    },
    (value: any) => {
      value.bindings.parent.slots.copy.target = {
        kind: 'grant',
        policy: { kind: 'command', run: 'index.ts' },
      }
    },
    (value: any) => {
      value.bindings.parent.slots.copy.target = {
        kind: 'route',
        target: mappedRoute.target,
        attachments,
      }
    },
    (value: any) => {
      value.bindings.parent.slots.copy.attachments = {}
    },
    (value: any) => {
      value.bindings.parent.slots.second = {
        ...mappedRoute,
        attachments: { files: { into: 'reports', directory: 'copies' } },
      }
    },
    (value: any) => {
      value.packages['flows/child'].slots = { next: mappedRoute }
    },
    (value: any) => {
      value.bindings.child = {
        packagePath: 'flows/child',
        settings: {},
        slots: {},
        attachments: { reference: { source: 'fixtures', digest, files: [] } },
      }
      value.bindings.parent.slots.copy.target = { kind: 'binding', id: 'child' }
    },
  ]) {
    const value = structuredClone(lockValue)
    mutate(value)
    expect(() => decode(value)).toThrow()
  }
  const childBinding = structuredClone(lockValue) as any
  childBinding.bindings.child = { packagePath: 'flows/child', settings: {}, slots: {} }
  childBinding.bindings.parent.slots.copy.target = { kind: 'binding', id: 'child' }
  expect(decode(childBinding).bindings.parent!.slots.copy).toMatchObject({
    target: { kind: 'binding', id: 'child' },
    attachments,
  })
})

test('published schemas describe closed review shapes without widening ordinary defaults', async () => {
  const author = compileSchemaFile(
    await readFile(
      new URL('../../../docs/jig/spec/machine/project-authoring-1.schema.json', import.meta.url),
    ),
    'project-authoring-1.schema.json',
  )
  const lock = compileSchemaFile(
    await readFile(
      new URL('../../../docs/jig/spec/machine/jig-lock-1.schema.json', import.meta.url),
    ),
    'jig-lock-1.schema.json',
  )
  const binding = defineBinding({
    package: 'flows/parent',
    slots: {
      copy: { target: 'flow:flows/child', attachments },
    },
  })
  expect(() => author.validate(binding, 'INVALID')).not.toThrow()
  expect(() => lock.validate(lockValue, 'INVALID')).not.toThrow()
  for (const route of [
    { ...mappedRoute, target: { kind: 'grant', policy: { kind: 'command', run: 'index.ts' } } },
    { ...mappedRoute, attachments: {} },
    { ...mappedRoute, attachments: { source: { from: 'originals', extra: true } } },
    { ...mappedRoute, mappingDigest: digest },
  ]) {
    const value = structuredClone(lockValue) as any
    value.bindings.parent.slots.copy = route
    expect(() => lock.validate(value, 'INVALID')).toThrow()
  }
  const direct = structuredClone(lockValue) as any
  direct.packages['flows/child'].slots = { copy: mappedRoute }
  expect(() => lock.validate(direct, 'INVALID')).toThrow()
  const defaults = { defaultProviders: { 'https://example.org/child': binding.slots.copy } }
  expect(() => author.validate(defaults, 'INVALID')).toThrow()
})

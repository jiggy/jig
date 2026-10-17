import { expect, test } from 'bun:test'
import {
  normalizeBindingAttachmentMap,
  validateBindingAttachmentMapForInterfaces,
} from '../../src/project/attachment-routes.js'

test('attachment maps normalize complete closed read and write mappings canonically', () => {
  const map = normalizeBindingAttachmentMap({
    source: { from: 'source' },
    files: { create: true },
    previous: { supplied: 'read' },
  })
  expect(Object.keys(map)).toEqual(['files', 'previous', 'source'])
  expect(map).toEqual({
    files: { create: true },
    previous: { supplied: 'read' },
    source: { from: 'source' },
  })
  expect(Object.isFrozen(map)).toBe(true)
  expect(Object.isFrozen(map.files)).toBe(true)
  for (const malformed of [
    {},
    { source: {} },
    { files: { unknown: true } },
    { files: { create: false } },
    { files: { create: true, from: 'source' } },
    { files: { create: true, extra: 1 } },
    { source: { supplied: 'read-write' } },
    { source: { supplied: 'read', from: 'source' } },
    { source: { from: 'source', extra: true } },
    { source: { from: 'Source' } },
    { 'source\n': { from: 'source' } },
    { source: { from: 'a'.repeat(65) } },
    Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`read-${index}`, { from: 'source' }]),
    ),
  ])
    expect(() => normalizeBindingAttachmentMap(malformed)).toThrow()
})
test('nested attachment maps reject accessors, hidden fields and proxy reflection failures', () => {
  let invoked = false
  let proxyTraps = 0
  const mapping = {
    get from() {
      invoked = true
      return 'source'
    },
  }
  const proxy = new Proxy(
    { from: 'source' },
    {
      getPrototypeOf() {
        proxyTraps++
        throw new Error('trap')
      },
      ownKeys() {
        proxyTraps++
        throw new Error('trap')
      },
      getOwnPropertyDescriptor() {
        proxyTraps++
        throw new Error('trap')
      },
    },
  )
  const hidden = Object.defineProperty({}, 'from', { value: 'source', enumerable: false })
  for (const value of [
    { source: mapping },
    { source: proxy },
    { source: hidden },
    { source: { from: 'source', [Symbol('extra')]: true } },
  ])
    expect(() => normalizeBindingAttachmentMap(value)).toThrow()
  expect(invoked).toBe(false)
  expect(proxyTraps).toBe(1)
  const reported = new Proxy({ from: 'source' }, {})
  const copied = normalizeBindingAttachmentMap({ source: reported })
  expect(copied.source).toEqual({ from: 'source' })
  expect(copied.source).not.toBe(reported)
  expect(Object.isFrozen(copied.source)).toBe(true)
})
test('interface admission requires every child port and immediate-caller modes without escalation', () => {
  const attachments = {
    source: { from: 'originals' },
    files: { create: true },
    previous: { supplied: 'read' },
  }
  const valid = {
    attachments,
    caller: { originals: 'read' },
    child: { source: 'read', previous: 'read', files: 'read-write' },
  } as const
  expect(validateBindingAttachmentMapForInterfaces(valid)).toEqual(
    normalizeBindingAttachmentMap(attachments),
  )
  expect(
    validateBindingAttachmentMapForInterfaces({
      ...valid,
      caller: { ...valid.caller, reports: 'read-write' },
    }),
  ).toEqual(normalizeBindingAttachmentMap(attachments))
  expect(
    validateBindingAttachmentMapForInterfaces({
      attachments: { first: { from: 'originals' }, second: { from: 'originals' } },
      caller: valid.caller,
      child: { first: 'read', second: 'read' },
    }),
  ).toEqual({ first: { from: 'originals' }, second: { from: 'originals' } })
  for (const change of [
    { attachments: { source: attachments.source } },
    { child: { source: 'read' } },
    { caller: { originals: 'read-write' } },
    { caller: {} },
    { child: { source: 'read', previous: 'read-write', files: 'read' } },
    { child: { source: 'read-write', files: 'read-write' } },
    { child: {} },
    { attachments: { ...attachments, other: { from: 'originals' } } },
  ])
    expect(() =>
      validateBindingAttachmentMapForInterfaces({ ...valid, ...change } as typeof valid),
    ).toThrow()
})
test('operation-created writable mappings need no writable caller authority', () => {
  expect(
    validateBindingAttachmentMapForInterfaces({
      attachments: { files: { create: true } },
      caller: {},
      child: { files: 'read-write' },
    }),
  ).toEqual({ files: { create: true } })
})

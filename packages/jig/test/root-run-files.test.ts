import { expect, test } from 'bun:test'
import {
  normalizePrivateRunFileIdentity,
  PrivateRootFileInputLimitError,
  PrivateRootFileMappingError,
  requirePrivateRootFileMapping,
} from '../src/internal/root-run-files.js'
import type { PrivateActivationRequest } from '../src/project/package-resolution.js'

const digest = `sha256:${'0'.repeat(64)}`
const file = (path: string, bytes = 0) => ({ path, bytes, digest })

test('mapping refusal lists all missing reads, invalid names, bound overrides and writable names', () => {
  const request = {
    attachments: { source: 'read', reference: 'read', retained: 'read', evidence: 'read-write' },
    boundAttachments: { retained: { files: [] } },
  } as unknown as PrivateActivationRequest
  const identity = normalizePrivateRunFileIdentity({
    attachments: [
      { name: 'unknown', files: [] },
      { name: 'retained', files: [] },
    ],
    output: null,
  })
  let caught: unknown
  try {
    requirePrivateRootFileMapping(request, identity)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(PrivateRootFileMappingError)
  expect((caught as PrivateRootFileMappingError).fileMapping).toEqual({
    missingReads: ['reference', 'source'],
    unknownNames: ['unknown'],
    boundOverrides: ['retained'],
    missingWritableDestination: ['evidence'],
  })
  expect(JSON.stringify((caught as PrivateRootFileMappingError).fileMapping)).not.toContain('/')
  expect(() =>
    requirePrivateRootFileMapping(
      request,
      normalizePrivateRunFileIdentity({
        attachments: [
          { name: 'source', files: [] },
          { name: 'reference', files: [] },
        ],
        output: '/chosen-output',
      }),
    ),
  ).not.toThrow()
})

test('empty declared input trees remain valid and ordering does not change mapping meaning', () => {
  const request = {
    attachments: { second: 'read', first: 'read' },
  } as unknown as PrivateActivationRequest
  const identity = normalizePrivateRunFileIdentity({
    attachments: [
      { name: 'second', files: [] },
      { name: 'first', files: [] },
    ],
    output: null,
  })
  expect(() => requirePrivateRootFileMapping(request, identity)).not.toThrow()
})

test('combined retained and per-run file count and byte limits remain authoritative', () => {
  for (const files of [
    Array.from({ length: 64 }, (_, index) => file(`file-${index}`)),
    [file('large', 8 * 1024 * 1024)],
  ]) {
    const request = {
      attachments: { source: 'read', retained: 'read' },
      boundAttachments: { retained: { files: [file('retained', 1)] } },
    } as unknown as PrivateActivationRequest
    const identity = normalizePrivateRunFileIdentity({
      attachments: [{ name: 'source', files }],
      output: null,
    })
    expect(() => requirePrivateRootFileMapping(request, identity)).toThrow(
      PrivateRootFileInputLimitError,
    )
  }
})

test('only bounded attachment names can enter the closed diagnostic', () => {
  expect(
    () =>
      new PrivateRootFileMappingError({
        missingReads: ['private/path'],
        unknownNames: [],
        boundOverrides: [],
        missingWritableDestination: [],
      }),
  ).toThrow()
  expect(
    () =>
      new PrivateRootFileMappingError({
        missingReads: Array.from({ length: 9 }, (_, index) => `name-${index}`),
        unknownNames: [],
        boundOverrides: [],
        missingWritableDestination: [],
      }),
  ).toThrow()
})

import { describe, expect, test } from 'bun:test'

import { requirePrivateBunLockPolicy } from '../src/internal/bun-native-lock-policy.js'
import {
  PRIVATE_BUN_PREPARATION_LIMITS,
  PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
  PRIVATE_BUN_SOURCE_MESSAGE_BYTES,
  encodePrivateBunMessage,
  maximumPrivateBunFileMessageBytes,
  privateBunMessageFits,
} from '../src/internal/bun-native-preparation-protocol.js'
import { PACKAGE_1_MAX_PATH_BYTES } from '../src/package/paths.js'

const INTEGRITY =
  'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='

describe('private Bun preparation policy', () => {
  test.each([
    ['Git', ['value@git+https://github.com/example/value.git#abcdef', {}]],
    ['GitHub', ['value@github:example/value#abcdef', {}]],
    ['tarball', ['value@https://example.invalid/value.tgz', {}]],
    ['file', ['value@file:../value', {}]],
    [
      'four-field Git',
      ['value@git+https://github.com/example/value.git#abcdef', '', {}, INTEGRITY],
    ],
    ['four-field tarball', ['value@https://example.invalid/value.tgz', '', {}, INTEGRITY]],
    ['short integrity', ['value@1.0.0', '', {}, 'sha512-A']],
  ])('rejects a %s package source', (_label, resolution) => {
    expect(() => requirePrivateBunLockPolicy(lock({ value: resolution }))).toThrow(
      'unsupported Bun lock source',
    )
  })

  test('rejects a workspace graph and a custom registry', () => {
    expect(() =>
      requirePrivateBunLockPolicy({
        ...lock({}),
        workspaces: { '': {}, packages: {} },
      }),
    ).toThrow('unsupported Bun lock source')
    expect(() =>
      requirePrivateBunLockPolicy(
        lock({
          value: ['value@1.0.0', 'https://packages.example.invalid', {}, INTEGRITY],
        }),
      ),
    ).toThrow('unsupported Bun lock source')
  })

  test.each([
    ['file', 'file:../value'],
    ['Git', 'git+https://github.com/example/value.git#abcdef'],
    ['GitHub', 'github:example/value#abcdef'],
    ['GitHub shorthand', 'example/value#abcdef'],
    ['tarball', 'https://example.invalid/value.tgz'],
    ['workspace', 'workspace:*'],
    ['parent path', '../value'],
    ['npm alias to file', 'npm:value@file:../value'],
    ['npm alias to Git', 'npm:value@git+https://github.com/example/value.git#abcdef'],
  ])('rejects a root %s request even when the package map is empty', (_label, request) => {
    expect(() =>
      requirePrivateBunLockPolicy({
        lockfileVersion: 1,
        workspaces: { '': { dependencies: { value: request } } },
        packages: {},
      }),
    ).toThrow('unsupported Bun lock source')
  })

  test.each([
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ] as const)('rejects unsupported sources in package %s metadata', (field) => {
    expect(() =>
      requirePrivateBunLockPolicy(
        lock({
          value: ['value@1.0.0', '', { [field]: { nested: 'file:../nested' } }, INTEGRITY],
        }),
      ),
    ).toThrow('unsupported Bun lock source')
  })

  test('rejects malformed dependency maps and requests', () => {
    expect(() =>
      requirePrivateBunLockPolicy({
        ...lock({}),
        workspaces: { '': { dependencies: [] } },
      }),
    ).toThrow('unsupported Bun lock source')
    expect(() =>
      requirePrivateBunLockPolicy({
        ...lock({}),
        workspaces: { '': { dependencies: { value: 1 } } },
      }),
    ).toThrow('unsupported Bun lock source')
  })

  test('accepts default-registry requests in root and package metadata', () => {
    expect(() =>
      requirePrivateBunLockPolicy({
        lockfileVersion: 1,
        workspaces: {
          '': {
            dependencies: { value: '1.0.0', 'hyphen-range': '1.2.3 - 2.3.4' },
            devDependencies: { tagged: 'next', 'or-range': '1.2.3 || 2.x' },
          },
        },
        packages: {
          value: [
            'value@1.0.0',
            '',
            {
              dependencies: { nested: '^2.0.0' },
              optionalDependencies: { optional: '>= 2.1.2 < 3.0.0' },
              peerDependencies: { peer: '^3.25.0 || ^4.0.0' },
            },
            INTEGRITY,
          ],
        },
      }),
    ).not.toThrow()
  })

  test('accepts resolved default-registry provenance for an npm alias', () => {
    expect(() =>
      requirePrivateBunLockPolicy({
        lockfileVersion: 1,
        workspaces: {
          '': { dependencies: { alias: 'npm:value@1.0.0' } },
        },
        packages: {
          alias: [
            'value@1.0.0',
            '',
            {
              optionalDependencies: { 'nested-alias': 'npm:@example/value@^1.0.0' },
            },
            INTEGRITY,
          ],
        },
      }),
    ).not.toThrow()
  })

  test('derives line bounds which contain an actual near-limit encoded value', () => {
    expect(PRIVATE_BUN_SOURCE_MESSAGE_BYTES).toBe(
      maximumPrivateBunFileMessageBytes(
        'source',
        PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles,
        PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes,
      ),
    )
    expect(PRIVATE_BUN_PREPARED_MESSAGE_BYTES).toBe(
      maximumPrivateBunFileMessageBytes(
        'prepared',
        PRIVATE_BUN_PREPARATION_LIMITS.preparedFiles,
        PRIVATE_BUN_PREPARATION_LIMITS.preparedBytes,
      ),
    )
    const segment = '\u0001'.repeat(255)
    const path = `${`p0000${'\u0001'.repeat(250)}`}/${segment}/${segment}/${'\u0001'.repeat(254)}/x`
    expect(Buffer.byteLength(path)).toBe(PACKAGE_1_MAX_PATH_BYTES)
    const content = Buffer.alloc(
      PRIVATE_BUN_PREPARATION_LIMITS.sourceBytes / PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles,
      0xa5,
    ).toString('base64')
    const files = Array.from(
      { length: PRIVATE_BUN_PREPARATION_LIMITS.sourceFiles },
      (_, index) => ({
        path: path.replace('0000', index.toString(16).padStart(4, '0')),
        content,
      }),
    )
    const actual = encodePrivateBunMessage({ type: 'source', files }).byteLength - 1
    expect(privateBunMessageFits(actual, PRIVATE_BUN_SOURCE_MESSAGE_BYTES)).toBeTrue()
    expect(PRIVATE_BUN_SOURCE_MESSAGE_BYTES - actual).toBeLessThan(256 * 1024)
    expect(
      privateBunMessageFits(PRIVATE_BUN_PREPARED_MESSAGE_BYTES, PRIVATE_BUN_PREPARED_MESSAGE_BYTES),
    ).toBeTrue()
    expect(
      privateBunMessageFits(
        PRIVATE_BUN_PREPARED_MESSAGE_BYTES + 1,
        PRIVATE_BUN_PREPARED_MESSAGE_BYTES,
      ),
    ).toBeFalse()
  })
})

function lock(packages: Readonly<Record<string, unknown>>): object {
  return {
    lockfileVersion: 1,
    workspaces: { '': {} },
    packages,
  }
}

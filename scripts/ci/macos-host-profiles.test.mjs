import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAC_HOST_PROFILES, requireMacHostPrerequisites } from './macos-host-profiles.mjs'

function evidence(architecture, build) {
  return {
    kind: 'macos-host-prerequisites/1',
    arch: architecture,
    kernel: '24.6.0',
    build,
    bun: '1.4.2',
    revision: '744846f844374847c902b5e7fd59b4342a51ef99',
    processIdentityBytes: 56,
    coalitionIdentityBytes: 40,
    coalitionUsageBytes: 296,
    pidVersion: 0,
    backendQualified: false,
  }
}

test('hosted candidate pool keeps only its three exact native tuples', () => {
  assert.ok(Object.isFrozen(MAC_HOST_PROFILES))
  assert.deepEqual(Object.keys(MAC_HOST_PROFILES), ['x64', 'arm64'])
  assert.deepEqual(
    Object.entries(MAC_HOST_PROFILES).flatMap(([architecture, profiles]) => {
      assert.ok(Object.isFrozen(profiles))
      return profiles.map((profile) => {
        assert.ok(Object.isFrozen(profile))
        return `${architecture}/${profile.kernel}/${profile.build}/${profile.bun}/${profile.revision}`
      })
    }),
    [
      'x64/24.6.0/24G830/1.4.2/744846f844374847c902b5e7fd59b4342a51ef99',
      'arm64/24.6.0/24G830/1.4.2/744846f844374847c902b5e7fd59b4342a51ef99',
      'arm64/24.6.0/24H232/1.4.2/744846f844374847c902b5e7fd59b4342a51ef99',
    ],
  )
})

test('prerequisites admit both exact ARM pool builds without claiming qualification', () => {
  for (const [architecture, build] of [
    ['x64', '24G830'],
    ['arm64', '24G830'],
    ['arm64', '24H232'],
  ]) {
    const observed = evidence(architecture, build)
    assert.equal(requireMacHostPrerequisites(observed, architecture), observed)
    assert.equal(observed.backendQualified, false)
  }
})

test('kernel, architecture and toolchain neighbors cannot widen the hosted pool', () => {
  for (const architecture of ['x64', 'arm64', 'ia32', '__proto__'])
    for (const kernel of ['24.6.0', '24.6.1'])
      for (const build of ['24G830', '24H232', '24H233'])
        for (const bun of ['1.4.2', '1.4.3'])
          for (const revision of ['744846f844374847c902b5e7fd59b4342a51ef99', 'changed']) {
            const observed = { ...evidence(architecture, build), kernel, bun, revision }
            const admitted =
              ['x64', 'arm64'].includes(architecture) &&
              kernel === '24.6.0' &&
              (build === '24G830' || (architecture === 'arm64' && build === '24H232')) &&
              bun === '1.4.2' &&
              revision === '744846f844374847c902b5e7fd59b4342a51ef99'
            if (admitted)
              assert.equal(requireMacHostPrerequisites(observed, architecture), observed)
            else assert.throws(() => requireMacHostPrerequisites(observed, architecture))
          }
})

test('candidate identity never substitutes for complete native prerequisite evidence', () => {
  for (const build of ['24G830', '24H232']) {
    const observed = evidence('arm64', build)
    for (const mutation of [
      { kind: 'other' },
      { arch: 'x64' },
      { processIdentityBytes: 55 },
      { coalitionIdentityBytes: 41 },
      { coalitionUsageBytes: 295 },
      { pidVersion: -1 },
      { pidVersion: 1.5 },
      { pidVersion: Number.MAX_SAFE_INTEGER + 1 },
      { pidVersion: undefined },
      { backendQualified: true },
      { backendQualified: undefined },
    ])
      assert.throws(() => requireMacHostPrerequisites({ ...observed, ...mutation }, 'arm64'))
    assert.throws(() => requireMacHostPrerequisites(observed, 'x64'))
  }
  assert.throws(() => requireMacHostPrerequisites(null, 'arm64'))
})

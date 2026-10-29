// Exact hosted candidates. Prerequisites never establish native qualification.
export const MAC_HOST_PROFILES = Object.freeze({
  x64: Object.freeze([
    Object.freeze({
      kernel: '24.6.0',
      build: '24G830',
      bun: '1.4.2',
      revision: '744846f844374847c902b5e7fd59b4342a51ef99',
    }),
  ]),
  arm64: Object.freeze([
    Object.freeze({
      kernel: '24.6.0',
      build: '24G830',
      bun: '1.4.2',
      revision: '744846f844374847c902b5e7fd59b4342a51ef99',
    }),
    Object.freeze({
      kernel: '24.6.0',
      build: '24H232',
      bun: '1.4.2',
      revision: '744846f844374847c902b5e7fd59b4342a51ef99',
    }),
  ]),
})

export function requireMacHostPrerequisites(evidence, architecture) {
  const expected = MAC_HOST_PROFILES[architecture]
  if (
    !Object.hasOwn(MAC_HOST_PROFILES, architecture) ||
    evidence?.kind !== 'macos-host-prerequisites/1' ||
    evidence.arch !== architecture ||
    !expected.some((profile) =>
      Object.entries(profile).every(([key, value]) => evidence[key] === value),
    ) ||
    evidence.processIdentityBytes !== 56 ||
    evidence.coalitionIdentityBytes !== 40 ||
    evidence.coalitionUsageBytes !== 296 ||
    !Number.isSafeInteger(evidence.pidVersion) ||
    evidence.pidVersion < 0 ||
    evidence.backendQualified !== false
  )
    throw new Error(
      'Mac host prerequisites do not match the exact hosted architecture, kernel, build and Bun target',
    )
  return evidence
}

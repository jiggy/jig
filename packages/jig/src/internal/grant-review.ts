import { canonicalJson, type JsonValue } from '../json.js'
import type { PrivateProjectLocalLock } from './project-local-lock.js'

/** Stable recipients retain powers across explicitly reviewed source revisions, not across replacement routes. */
export function grantChanges(
  before: PrivateProjectLocalLock | null,
  after: PrivateProjectLocalLock,
) {
  const collect = (lock: PrivateProjectLocalLock | null) =>
    Object.fromEntries(
      Object.entries(lock?.bindings ?? {}).flatMap(([binding, value]) =>
        Object.entries(value.slots).flatMap(([slot, route]) =>
          route.kind !== 'grant'
            ? []
            : [
                [
                  `binding:${binding}/${slot}`,
                  {
                    packagePath: value.packagePath,
                    contract: lock!.packages[value.packagePath]!.uses[slot]!,
                    policy: route.policy,
                  },
                ],
              ],
        ),
      ),
    )
  const old = collect(before)
  const next = collect(after)
  return [...new Set([...Object.keys(old), ...Object.keys(next)])].sort().flatMap((recipient) => {
    const previous = old[recipient] ?? null
    const proposed = next[recipient] ?? null
    return Buffer.from(canonicalJson(previous as JsonValue)).equals(
      Buffer.from(canonicalJson(proposed as JsonValue)),
    )
      ? []
      : [{ recipient, before: previous, after: proposed }]
  })
}

export function requiresAuthorityApproval(
  before: PrivateProjectLocalLock | null,
  after: PrivateProjectLocalLock,
): boolean {
  return grantChanges(before, after).some((change) => change.after !== null)
}

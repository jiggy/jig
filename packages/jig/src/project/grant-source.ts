import { validateGrantPolicy } from './grant-validation.js'
import { invalid } from '../diagnostics.js'
import { decodeJson1 } from '../json.js'
import type { ProjectSource } from './author.js'
import { captureDeclarationSource } from './declaration-source.js'
import { type GrantPolicy, grantName, normalizeGrant } from './grants.js'
import type { PrivateProjectRoot } from './root.js'

/** Capture a shallow, inert catalog under the same root as the reviewed project. */
export async function captureGrantSource(root: PrivateProjectRoot, selection?: ProjectSource) {
  const source = await captureDeclarationSource(root, selection, 'json')
  if (source.members.length > 256)
    invalid('PROJECT_GRANTS_LIMIT', 'grant catalog exceeds 256 entries', 'jig.ts')
  const grants: Record<string, GrantPolicy> = Object.create(null)
  let bytes = 0
  for (const member of source.members) {
    const content = await source.read(member, 32768)
    bytes += content.byteLength
    if (bytes > 1048576) invalid('PROJECT_GRANTS_LIMIT', 'grant catalog exceeds 1 MiB', 'jig.ts')
    try {
      const policy = normalizeGrant(decodeJson1(content))
      validateGrantPolicy(policy)
      grants[grantName(member.id)] = policy
    } catch (error) {
      invalid(
        'PROJECT_GRANT_INVALID',
        error instanceof Error ? error.message : String(error),
        member.projectPath,
      )
    }
  }
  await source.verify()
  return Object.freeze({
    grants: Object.freeze(grants),
    observations: source.observations,
    verify: source.verify,
  })
}

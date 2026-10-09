import { createHash } from 'node:crypto'
import descriptor from './user-updates.json' with { type: 'json' }
import { canonicalUserUpdate } from './validation.js'

export type { NoticeSeverity, Progress, UserUpdate } from './validation.js'
export { canonicalUserUpdate, USER_UPDATES_LIMITS, validateUserUpdate } from './validation.js'

export const USER_UPDATES_CONTRACT = Object.freeze({
  id: descriptor.id,
  version: descriptor.version,
  digest: `sha256:${createHash('sha256').update('FLOW-Channel-Contract/0\0').update(canonicalUserUpdate(descriptor)).digest('hex')}`,
})

import { createHash } from 'node:crypto'
import descriptor from './reporting.json' with { type: 'json' }
import { canonicalReportingMessage } from './validation.js'

export type { NoticeSeverity, Progress, ReportingMessage } from './validation.js'
export {
  canonicalReportingMessage,
  REPORTING_LIMITS,
  validateReportingMessage,
} from './validation.js'

export const REPORTING_CONTRACT = Object.freeze({
  id: descriptor.id,
  version: descriptor.version,
  digest: `sha256:${createHash('sha256').update('FLOW-Channel-Contract/0\0').update(canonicalReportingMessage(descriptor)).digest('hex')}`,
})

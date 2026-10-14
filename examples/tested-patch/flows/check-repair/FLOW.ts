import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { checkRepairEvidence } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', (reporter) => checkRepairEvidence(run, reporter)),
)

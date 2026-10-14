import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { checkCredit } from './method.ts'

await handle((run) => withReporting(run, 'progress', (reporter) => checkCredit(run, reporter)))

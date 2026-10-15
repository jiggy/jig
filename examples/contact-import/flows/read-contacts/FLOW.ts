import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { readContacts } from './method.ts'

await handle((run) => withReporting(run, 'progress', (reporter) => readContacts(run, reporter)))

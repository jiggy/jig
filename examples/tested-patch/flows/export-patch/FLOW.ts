import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { exportPatch } from './method.ts'

await handle((run) => withReporting(run, 'progress', (reporter) => exportPatch(run, reporter)))

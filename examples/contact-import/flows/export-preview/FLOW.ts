import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { exportPreview } from './method.ts'

await handle((run) => withReporting(run, 'progress', (reporter) => exportPreview(run, reporter)))

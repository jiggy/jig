import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { captureProject } from './method.ts'

await handle((run) => withReporting(run, 'progress', (reporter) => captureProject(run, reporter)))

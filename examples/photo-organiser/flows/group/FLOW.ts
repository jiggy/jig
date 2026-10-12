import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { groupPhotos } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await groupPhotos(run, updates)
    } catch (error) {
      updates.notice('Caption grouping failed; no files are accessible to this Flow.', 'error')
      throw error
    } finally {
      updates.clear('group')
    }
  }),
)

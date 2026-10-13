import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { organisePhotos } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await organisePhotos(run, updates)
    } catch (error) {
      updates.notice(
        'Photo organisation failed. Originals are unchanged; inspect the final diagnostic before using any output.',
        'error',
      )
      throw error
    } finally {
      updates.clear('organise')
    }
  }),
)

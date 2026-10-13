import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { copyPhotos } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await copyPhotos(run, updates)
    } catch (error) {
      updates.notice('Photo copying did not complete. Originals are unchanged.', 'error')
      throw error
    } finally {
      updates.clear('copy-photos')
    }
  }),
)

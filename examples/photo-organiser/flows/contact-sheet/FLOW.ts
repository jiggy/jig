import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { createPhotoContactSheet } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await createPhotoContactSheet(run, updates)
    } catch (error) {
      updates.notice('Contact-sheet creation did not complete. Originals are unchanged.', 'error')
      throw error
    } finally {
      updates.clear('contact-sheet')
    }
  }),
)

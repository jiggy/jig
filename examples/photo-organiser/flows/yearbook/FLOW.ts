import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { createYearbook } from './method.ts'

await handle((run) =>
  withReporting(run, 'progress', async (updates) => {
    try {
      return await createYearbook(run, updates)
    } catch (error) {
      updates.notice('The yearbook could not be prepared. Originals remain unchanged.', 'error')
      throw error
    }
  }),
)

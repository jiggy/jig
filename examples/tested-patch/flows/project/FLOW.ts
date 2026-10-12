import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { repairFiles } from './files.ts'

await handle((run) =>
  withReporting(run, 'updates', async (updates) => {
    try {
      return await repairFiles(run, updates)
    } catch (error) {
      updates.notice(
        'Repair failed before a final review packet could be accepted. Inspect the final diagnostic.',
        'error',
      )
      throw error
    } finally {
      updates.clear('repair')
    }
  }),
)

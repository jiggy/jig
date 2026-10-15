import { handle } from '@jigging/flow'
import { withReporting } from '@jigging/reporting'
import { resolve } from './resolve.ts'

await handle((run) =>
  withReporting(run, 'progress', async (reporter) => {
    try {
      return await resolve(run, reporter)
    } catch (error) {
      reporter.notice(
        'Case handling failed. No credit or message was sent; inspect the final diagnostic.',
        'error',
      )
      throw error
    }
  }),
)

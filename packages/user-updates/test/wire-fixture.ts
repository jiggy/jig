import { handle, OperationError } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'

await handle(async (run) => {
  try {
    return await withUserUpdates(run, 'updates', (updates) => {
      updates.notice('Validating invoice batch')
      return { outcome: 'checked', output: { invoices: 2 } }
    })
  } catch (error) {
    if (!(error instanceof OperationError)) throw error
    return { outcome: 'publisher-failed', output: error.code }
  }
})

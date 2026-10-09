import { handle } from '@jigging/flow'
import { withUserUpdates } from '@jigging/user-updates'
import { contactsView, mappingView } from './dashboard.ts'
import { runMethod } from './method.ts'

await handle((run) =>
  withUserUpdates(run, 'progress', async (updates) => {
    const { headers, rows } = run.input as { headers: string[]; rows: string[][] }
    const mapping = updates.view('mapping', { title: 'Mapping', landing: true })
    const contacts = updates.view('contacts', { title: 'Contacts' })
    const rejected = updates.view('rejected', { title: 'Rejected rows' })
    mapping.update(mappingView(headers, rows.length))
    updates.activity('convert', 'Checking contact rows against the selected columns')
    try {
      const result = await runMethod(run)
      if ((result.output as { status: string }).status === 'needs_mapping')
        updates.notice(
          'Column selection needs clarification; no contact preview is ready.',
          'warning',
        )
      mapping.update(mappingView(headers, rows.length, result))
      contacts.update(contactsView(result, true, false))
      rejected.update(contactsView(result, false, false))
      return result
    } catch (error) {
      updates.notice('Contact conversion failed. Inspect the final diagnostic.', 'error')
      throw error
    } finally {
      updates.clear('convert')
    }
  }),
)

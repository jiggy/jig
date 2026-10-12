import type { RecordedViewRole } from '@jigging/display-model'

/** Reserved recorded roles are assigned only by the host capture adapter. */
export function privateRecordedViewRole(
  recorded: boolean | undefined,
  publisher: string,
  id: string,
): RecordedViewRole | undefined {
  if (!recorded || publisher !== 'saved-result') return undefined
  switch (id) {
    case 'recorded-result':
      return 'recorded-report'
    case 'files':
      return 'recorded-files'
    case 'diagnostics':
      return 'recorded-diagnostics'
    default:
      return undefined
  }
}

/** Private presentation vocabulary shared by browser and terminal adapters.
 * No renderer, navigation state, execution authority or author API lives here. */
export type PrivateRecordedViewRole = 'recorded-report' | 'recorded-files' | 'recorded-diagnostics'
export function privateRecordedViewRole(
  recorded: boolean | undefined,
  publisher: string,
  id: string,
): PrivateRecordedViewRole | undefined {
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
export type PrivateDisplayDestination = {
  key: string
  title: string
  source: string
  icon: string
  group: 'run' | 'application' | 'recorded'
}
export function privateDisplayDestinations(
  recorded: boolean,
  views: readonly {
    key: string
    title: string
    source: string
    role?: PrivateRecordedViewRole | undefined
  }[],
): PrivateDisplayDestination[] {
  const report = views.find((view) => view.role === 'recorded-report')
  const diagnostics = views.find((view) => view.role === 'recorded-diagnostics')
  return recorded
    ? [
        ...(report
          ? [
              {
                ...report,
                title: 'Recorded result',
                source: '',
                icon: '◈',
                group: 'recorded' as const,
              },
            ]
          : []),
        { key: 'files', title: 'Captured files', source: '', icon: '▤', group: 'recorded' },
        ...(diagnostics
          ? [
              {
                ...diagnostics,
                title: 'Diagnostics',
                source: '',
                icon: '!',
                group: 'recorded' as const,
              },
            ]
          : []),
        ...views
          .filter((view) => !view.role)
          .map((view) => ({ ...view, icon: '◈', group: 'recorded' as const })),
      ]
    : [
        { key: 'overview', title: 'Execution', source: '', icon: '↳', group: 'run' },
        { key: 'activity', title: 'Activity', source: '', icon: '≡', group: 'run' },
        { key: 'files', title: 'Delivered files', source: '', icon: '▤', group: 'run' },
        ...views.map((view) => ({ ...view, icon: '◈', group: 'application' as const })),
      ]
}

/** These intervals describe observations, never execution time or a verdict. */
export function privateCallObservationSpans(
  calls: readonly { id: string; firstObservedAt: number; observedAt: number }[],
): {
  milliseconds: number
  spans: Map<string, { x: number; width: number; milliseconds: number }>
} {
  const valid = calls.filter(
    (call) =>
      Number.isFinite(call.firstObservedAt) &&
      Number.isFinite(call.observedAt) &&
      call.firstObservedAt >= 0 &&
      call.observedAt >= call.firstObservedAt,
  )
  const first = Math.min(...valid.map((call) => call.firstObservedAt))
  const last = Math.max(...valid.map((call) => call.observedAt))
  const milliseconds = valid.length ? last - first : 0
  const scale = Math.max(1, milliseconds)
  return {
    milliseconds,
    spans: new Map(
      valid.map((call) => [
        call.id,
        {
          x: ((call.firstObservedAt - first) / scale) * 1000,
          width: ((call.observedAt - call.firstObservedAt) / scale) * 1000,
          milliseconds: call.observedAt - call.firstObservedAt,
        },
      ]),
    ),
  }
}
export function privateDisplayDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(1)}s`
  return `${Math.floor(milliseconds / 60000)}m ${Math.floor((milliseconds % 60000) / 1000)}s`
}

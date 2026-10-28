import { createHash } from 'node:crypto'
import type { Section, ViewOptions, ViewSnapshot } from '@jigging/reporting'

// These types describe the declared reading and checking results. Presentation
// consumes those results; it does not repeat the child Flows' scheduling policy.
export type RosterScenario = {
  shifts: { id: string; from: number; until: number }[]
  volunteers: {
    id: string
    name: string
    roles: string[]
    available: { from: number; until: number }[]
    maxMinutes: number
    preference: string
  }[]
}
export type AcceptedAssignment = {
  shiftId: string
  role: string
  volunteerId: string
  name: string
  from: number
  until: number
}
export type RosterState = {
  phase:
    | 'reading'
    | 'proposing'
    | 'checking'
    | 'exporting'
    | 'ready'
    | 'blocked'
    | 'limit'
    | 'cancelled'
    | 'failed'
  scenario?: RosterScenario
  assignments?: AcceptedAssignment[]
  reason?: string
}

function clockTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

const phases = {
  reading: ['Reading volunteer availability', 0],
  proposing: ['Considering volunteer preferences', 1],
  checking: ['Checking all scheduling rules', 2],
  exporting: ['Preparing the roster CSV', 3],
  ready: ['Roster prepared', 4],
  blocked: ['Roster needs attention', 0],
  limit: ['Scheduling limit reached', 0],
  cancelled: ['Scheduling cancelled', 0],
  failed: ['Scheduling stopped', 0],
} as const

/** The checked source scenario identifies this finite roster, not its Run. */
export function rosterViewOptions(scenario: RosterScenario): ViewOptions {
  const scenarioKey = createHash('sha256').update(JSON.stringify(scenario)).digest('hex')
  return {
    title: 'Saturday kitchen',
    landing: true,
    target: { definitionId: 'kitchen-roster', instanceKey: scenarioKey, subjectKey: scenarioKey },
  }
}

export function rosterView(state: RosterState): ViewSnapshot {
  const assignments = state.assignments ?? []
  const accepted = assignments.length === 8
  const [label, completed] = phases[state.phase]
  let csvStatus = 'Not prepared'
  if (state.phase === 'exporting') csvStatus = 'Preparing the CSV'
  if (state.phase === 'ready') csvStatus = 'Prepared; Jig confirms delivery separately'
  if (accepted && (state.phase === 'failed' || state.phase === 'cancelled')) {
    csvStatus = 'Unconfirmed; inspect the run result for any delivered files'
  }
  const sections: Section[] = [
    {
      title: 'Roster status',
      blocks: [
        { kind: 'progress', label, completed, total: 4, unit: 'stages' },
        {
          kind: 'facts',
          items: [
            {
              label: 'Coverage',
              value: accepted ? '8 of 8 roles checked' : 'No assignments accepted',
            },
            {
              label: 'CSV',
              value: csvStatus,
            },
          ],
        },
        {
          kind: 'report',
          text:
            state.reason ??
            'Availability, qualifications, overlaps and workload are hard rules. Preferences guide the proposal.',
        },
      ],
    },
  ]

  for (const shift of state.scenario?.shifts ?? []) {
    const cook = assignments.find((row) => row.shiftId === shift.id && row.role === 'cook')
    const server = assignments.find((row) => row.shiftId === shift.id && row.role === 'serve')
    sections.push({
      title: `${clockTime(shift.from)}–${clockTime(shift.until)}`,
      blocks: [
        {
          kind: 'facts',
          items: [
            { label: 'Cook', value: cook?.name ?? 'Awaiting checked assignment' },
            { label: 'Serve', value: server?.name ?? 'Awaiting checked assignment' },
            { label: 'Coverage', value: cook && server ? 'Both roles checked' : 'Unassigned' },
          ],
        },
      ],
    })
  }

  if (state.scenario)
    sections.push({
      title: 'The volunteer team',
      blocks: [
        {
          kind: 'collection',
          id: 'volunteers',
          title: 'Availability and workload',
          columns: [
            { key: 'name', label: 'Volunteer', type: 'text' },
            { key: 'availability', label: 'Available', type: 'text' },
            { key: 'roles', label: 'Roles', type: 'text' },
            { key: 'workload', label: 'Assigned / limit', type: 'text' },
          ],
          rows: state.scenario.volunteers.map((person) => ({
            id: person.id,
            cells: {
              name: person.name,
              availability: person.available
                .map((interval) => `${clockTime(interval.from)}–${clockTime(interval.until)}`)
                .join(', '),
              roles: person.roles.join(', '),
              workload: `${assignments.filter((row) => row.volunteerId === person.id).reduce((total, row) => total + row.until - row.from, 0)} / ${person.maxMinutes} min`,
            },
            details: [{ kind: 'report', text: `Preference: ${person.preference}` }],
          })),
          total: state.scenario.volunteers.length,
        },
      ],
    })

  if (state.phase === 'ready')
    sections.push({
      title: 'Your roster',
      blocks: [
        {
          kind: 'report',
          text: 'Inspect the complete CSV before using this roster. Jig confirms delivery separately in the run result.',
          references: [{ kind: 'artifact', attachment: 'schedule', path: 'roster.csv' }],
        },
        {
          kind: 'content',
          title: 'Checked roster CSV',
          reference: { kind: 'artifact', attachment: 'schedule', path: 'roster.csv' },
        },
      ],
    })
  return {
    summary:
      'Cover four Saturday shifts with a cook and a server in each, using six volunteers’ availability and preferences.',
    sections,
  }
}

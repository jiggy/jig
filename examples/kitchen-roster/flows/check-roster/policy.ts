import { availableFor, readScenario, type Role } from './scenario.ts'

// A rejected proposal is an application decision, separate from a broken Run.
export class RosterPolicyError extends TypeError {}

export type RosterRow = {
  shiftId: string
  from: number
  until: number
  role: Role
  volunteerId: string
  name: string
}

export function checkRoster(scenarioValue: unknown, proposalValue: unknown): RosterRow[] | string {
  const scenario = readScenario(scenarioValue)
  if (!proposalValue || typeof proposalValue !== 'object' || Array.isArray(proposalValue)) {
    throw new RosterPolicyError('Supply a structured roster proposal.')
  }
  const proposal = proposalValue as Record<string, unknown>
  // A scalar may use two UTF-16 units. Bound storage before counting scalars.
  if (
    Object.keys(proposal).sort().join(',') !== 'assignments,reason,status' ||
    !Array.isArray(proposal.assignments) ||
    typeof proposal.reason !== 'string' ||
    proposal.reason.length > 240 * 2 ||
    Array.from(proposal.reason).length > 240
  ) {
    throw new RosterPolicyError('A proposal needs status, assignments and a bounded reason.')
  }
  if (proposal.status === 'review') {
    if (proposal.assignments.length !== 0 || proposal.reason.trim().length === 0) {
      throw new RosterPolicyError(
        'A review decision needs a reason and no provisional assignments.',
      )
    }
    return proposal.reason
  }
  if (
    proposal.status !== 'proposed' ||
    proposal.assignments.length !== 8 ||
    proposal.reason !== ''
  ) {
    throw new RosterPolicyError(
      'A proposed roster needs exactly eight assignments and an empty reason.',
    )
  }

  const coveredRoles = new Set<string>()
  const rows: RosterRow[] = []
  const minutesByVolunteer = new Map<string, number>()
  for (const value of proposal.assignments) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'role,shiftId,volunteerId'
    ) {
      throw new RosterPolicyError('Each assignment needs only shiftId, role and volunteerId.')
    }
    const assignment = value as Record<string, unknown>
    const shift = scenario.shifts.find((shift) => shift.id === assignment.shiftId)
    const person = scenario.volunteers.find((person) => person.id === assignment.volunteerId)
    if (!shift || !person) {
      throw new RosterPolicyError('Assignments must use known shift and volunteer IDs.')
    }
    const role = assignment.role
    if (role !== 'cook' && role !== 'serve') {
      throw new RosterPolicyError('Each assignment must choose cook or serve.')
    }
    const coverageKey = `${shift.id}/${role}`
    if (coveredRoles.has(coverageKey)) {
      throw new RosterPolicyError(`${coverageKey} is assigned more than once.`)
    }
    if (!person.roles.includes(role)) {
      throw new RosterPolicyError(`${person.name} is not qualified to ${role}.`)
    }
    if (!availableFor(person, shift)) {
      throw new RosterPolicyError(`${person.name} is unavailable for ${shift.id}.`)
    }
    const overlaps = rows.some(
      (row) => row.volunteerId === person.id && row.from < shift.until && shift.from < row.until,
    )
    if (overlaps) {
      throw new RosterPolicyError(`${person.name} has overlapping assignments.`)
    }
    const totalMinutes = (minutesByVolunteer.get(person.id) ?? 0) + shift.until - shift.from
    if (totalMinutes > person.maxMinutes) {
      throw new RosterPolicyError(`${person.name} exceeds the workload limit.`)
    }
    minutesByVolunteer.set(person.id, totalMinutes)
    coveredRoles.add(coverageKey)
    rows.push({
      shiftId: shift.id,
      from: shift.from,
      until: shift.until,
      role,
      volunteerId: person.id,
      name: person.name,
    })
  }
  // Eight unique known shift/role pairs cover exactly the four required shifts.
  return rows.sort(
    (left, right) =>
      left.from - right.from ||
      left.shiftId.localeCompare(right.shiftId) ||
      left.role.localeCompare(right.role),
  )
}

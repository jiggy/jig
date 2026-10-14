export type Role = 'cook' | 'serve'
export type Interval = { from: number; until: number }
export type Volunteer = {
  id: string
  name: string
  roles: Role[]
  available: Interval[]
  maxMinutes: number
  preference: string
}
export type Shift = Interval & { id: string }
export type Scenario = { volunteers: Volunteer[]; shifts: Shift[] }

function fields(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`)
  }
  return record
}

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new TypeError(`${label} must contain 1–${maximum} characters.`)
  }
  return value
}

function identifier(value: unknown, label: string): string {
  const id = text(value, 24, label)
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TypeError(`${label} must use lowercase letters, digits and hyphens.`)
  }
  return id
}

function minute(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 1440) {
    throw new TypeError(`${label} must be a minute within one day.`)
  }
  return value as number
}

function interval(from: unknown, until: unknown, label: string): Interval {
  const start = minute(from, `${label} start`)
  const end = minute(until, `${label} end`)
  if (start >= end) {
    throw new TypeError(`${label} must end after it starts.`)
  }
  return { from: start, until: end }
}

export function readScenario(value: unknown): Scenario {
  const input = fields(value, ['volunteers', 'shifts'], 'Scenario')
  if (!Array.isArray(input.volunteers) || input.volunteers.length !== 6) {
    throw new TypeError('Supply exactly six volunteers.')
  }
  if (!Array.isArray(input.shifts) || input.shifts.length !== 4) {
    throw new TypeError('Supply exactly four shifts.')
  }
  const volunteers = input.volunteers.map((value) => {
    const person = fields(
      value,
      ['id', 'name', 'roles', 'available', 'maxMinutes', 'preference'],
      'Volunteer',
    )
    const id = identifier(person.id, 'Volunteer ID')
    const name = text(person.name, 48, 'Volunteer name')
    if (!/^[A-Za-z][A-Za-z '\-]*$/.test(name)) {
      throw new TypeError('Volunteer names must use letters, spaces, apostrophes and hyphens.')
    }
    if (
      !Array.isArray(person.roles) ||
      person.roles.length < 1 ||
      person.roles.length > 2 ||
      person.roles.some((role) => role !== 'cook' && role !== 'serve') ||
      new Set(person.roles).size !== person.roles.length
    ) {
      throw new TypeError(`${id} needs unique cook/serve qualifications.`)
    }
    if (
      !Array.isArray(person.available) ||
      person.available.length < 1 ||
      person.available.length > 4
    ) {
      throw new TypeError(`${id} needs 1–4 availability intervals.`)
    }
    const available = person.available.map((value) => {
      const window = fields(value, ['from', 'until'], 'Availability')
      return interval(window.from, window.until, `${id} availability`)
    })
    if (
      !Number.isInteger(person.maxMinutes) ||
      (person.maxMinutes as number) < 1 ||
      (person.maxMinutes as number) > 240
    ) {
      throw new TypeError(`${id} needs a workload limit from 1 to 240 minutes.`)
    }
    return {
      id,
      name,
      roles: person.roles as Role[],
      available,
      maxMinutes: person.maxMinutes as number,
      preference: text(person.preference, 160, `${id} preference`),
    }
  })
  const shifts = input.shifts.map((value) => {
    const shift = fields(value, ['id', 'from', 'until'], 'Shift')
    const id = identifier(shift.id, 'Shift ID')
    return { id, ...interval(shift.from, shift.until, id) }
  })
  if (new Set(volunteers.map((person) => person.id)).size !== volunteers.length) {
    throw new TypeError('Volunteer IDs must be unique.')
  }
  if (new Set(shifts.map((shift) => shift.id)).size !== shifts.length) {
    throw new TypeError('Shift IDs must be unique.')
  }
  return { volunteers, shifts }
}

export function availableFor(person: Volunteer, shift: Shift): boolean {
  return person.available.some((window) => window.from <= shift.from && window.until >= shift.until)
}

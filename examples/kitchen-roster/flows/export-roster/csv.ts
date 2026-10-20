export type RosterRow = {
  shiftId: string
  from: number
  until: number
  role: 'cook' | 'serve'
  volunteerId: string
  name: string
}

export function clockTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function rosterCsv(rows: RosterRow[]): string {
  if (!Array.isArray(rows) || rows.length !== 8) {
    throw new TypeError('Export exactly eight roster rows.')
  }
  const lines = ['shift,start,end,role,volunteer_id,volunteer']
  for (const row of rows) {
    // Formatting has its own boundary. Fixed safe names cannot become formulas,
    // paths or additional CSV cells; scheduling policy belongs to check-roster.
    if (
      !/^[a-z][a-z0-9-]{0,23}$/.test(row.shiftId) ||
      !/^[a-z][a-z0-9-]{0,23}$/.test(row.volunteerId) ||
      !/^[A-Za-z][A-Za-z '\-]{0,47}$/.test(row.name)
    ) {
      throw new TypeError('Roster IDs and names must be safe CSV fields.')
    }
    if (row.role !== 'cook' && row.role !== 'serve') {
      throw new TypeError('Export only cook/serve roles.')
    }
    if (
      !Number.isInteger(row.from) ||
      !Number.isInteger(row.until) ||
      row.from < 0 ||
      row.until > 1440 ||
      row.from >= row.until
    ) {
      throw new TypeError('Export valid minute intervals within one day.')
    }
    lines.push(
      [
        row.shiftId,
        clockTime(row.from),
        clockTime(row.until),
        row.role,
        row.volunteerId,
        row.name,
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

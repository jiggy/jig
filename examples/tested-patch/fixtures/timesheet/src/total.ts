export function total(shifts: readonly { start: number; end: number }[]): number {
  return shifts.reduce((sum, shift) => sum + Math.max(0, shift.end - shift.start), 0)
}

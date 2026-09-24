export function parseTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) throw new Error('Invalid time')
  const hour = Number(match[1]),
    minute = Number(match[2])
  if (hour > 23) throw new Error('Invalid time')
  return hour * 60 + minute
}

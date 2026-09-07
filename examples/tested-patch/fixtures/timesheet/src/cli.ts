import { parseTime } from './parse.ts'
import { total } from './total.ts'
try {
  const input = (await Bun.stdin.text()).trim()
  const shifts = input === '' ? [] : input.split('\n').map(line => {
    const parts = line.split('-')
    if (parts.length !== 2) throw new Error('Invalid time')
    return { start: parseTime(parts[0]!), end: parseTime(parts[1]!) }
  })
  console.log(JSON.stringify({ minutes: total(shifts) }))
} catch {
  console.error('Invalid time')
  process.exitCode = 2
}

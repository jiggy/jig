import { parse } from './parse.ts'
import { report } from './report.ts'

try {
  const input = await Bun.stdin.text()
  const records = input
    .split('\n')
    .filter((line) => line.trim())
    .map(parse)
  console.log(JSON.stringify(report(records)))
} catch {
  console.error('Invalid log')
  process.exit(2)
}

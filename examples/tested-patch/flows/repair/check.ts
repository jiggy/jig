import { isDeepStrictEqual } from 'node:util'
import checks from './checks.json'

// This program receives observations only. It never imports candidate code.
const values: unknown = JSON.parse(await Bun.stdin.text())
if (!Array.isArray(values) || values.length !== checks.cases.length) {
  throw new TypeError('Expected one observed value for each acceptance case.')
}
const results = checks.cases.map(({ id, expected }, index) => ({
  id,
  expected,
  actual: values[index],
  passed: isDeepStrictEqual(values[index], expected),
}))
console.log(JSON.stringify({ results }))
process.exitCode = results.every(({ passed }) => passed) ? 0 : 1

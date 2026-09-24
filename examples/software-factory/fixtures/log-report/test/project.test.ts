import { expect, test } from 'bun:test'
import { parse } from '../src/parse.ts'
import { report } from '../src/report.ts'

test('parses ordinary access logs', () => {
  expect(parse('{"path":"/health","status":200}')).toEqual({ path: '/health', status: 200 })
})
test('rejects status codes outside the HTTP range', () => {
  for (const status of [99, 600, 200.5])
    expect(() => parse(JSON.stringify({ path: '/', status }))).toThrow()
})
test('distinguishes client and server failures', () => {
  expect(report([200, 404, 503].map((status) => ({ path: '/', status })))).toEqual({
    requests: 3,
    clientErrors: 1,
    serverErrors: 1,
  })
})
test('accepts an empty report', () => {
  expect(report([])).toEqual({ requests: 0, clientErrors: 0, serverErrors: 0 })
})

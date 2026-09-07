import { expect, test } from 'bun:test'
import { parseTime } from '../src/parse.ts'
import { total } from '../src/total.ts'
test('validates clock times', () => {
  expect(parseTime('09:30')).toBe(570)
  expect(() => parseTime('09:99')).toThrow()
  expect(() => parseTime('25:00')).toThrow()
})
test('counts midnight crossing without turning equal times into a full day', () => {
  expect(total([{ start: 1410, end: 15 }])).toBe(45)
  expect(total([{ start: 540, end: 630 }])).toBe(90)
  expect(total([{ start: 540, end: 540 }])).toBe(0)
})

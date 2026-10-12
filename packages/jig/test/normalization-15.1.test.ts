import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { normalizeNfc15_1 } from '../src/package/normalization-15.1.js'

test('matches every official Unicode 15.1 normalization conformance vector', async () => {
  const source = await readFile(new URL('./fixtures/normalization-15.1.txt', import.meta.url), 'utf8')
  let count = 0
  for (const line of source.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const columns = line.split(';').map((column) => column.split(' ').map((code) => String.fromCodePoint(Number.parseInt(code, 16))).join(''))
    expect(columns.length).toBe(5)
    for (const column of columns.slice(0, 3)) expect(normalizeNfc15_1(column)).toBe(columns[1]!)
    for (const column of columns.slice(3)) expect(normalizeNfc15_1(column)).toBe(columns[3]!)
    count++
  }
  expect(count).toBe(19074)
})

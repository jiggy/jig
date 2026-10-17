import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunResult } from '@jigging/flow'
import { runMethod as convert } from '../flows/convert/method.ts'
import { runMethod as importer, parseContacts } from '../flows/import/method.ts'
import { runMethod as known } from '../flows/map-code/method.ts'
import { runMethod as mixed } from '../flows/map-mixed/method.ts'

const headers = ['Customer', 'Email address', 'Company']
const mapping = { name: 0, email: 1, organization: 2 }
const signal = () => new AbortController().signal
const bytes = (text: string) => new TextEncoder().encode(text)
const fixture = (name: string) =>
  Bun.file(join(import.meta.dir, '../fixtures', name, 'contacts.csv')).text()
const completed = (output: RunResult['output']): RunResult => ({ outcome: 'done', output })

describe('CSV boundary', () => {
  test('uses a CSV parser for quotes, commas, BOM, CRLF and multiline cells', () => {
    expect(
      parseContacts(
        bytes(
          '\uFEFFCustomer,Email address,Company\r\n"Ada\nLovelace",ada@example.com,"Engines, Inc"\r\n',
        ),
      ).rows,
    ).toEqual([['Ada\nLovelace', 'ada@example.com', 'Engines, Inc']])
  })
  for (const [name, text] of Object.entries({
    empty: '',
    duplicate: 'Name, name\nx,y',
    blank: ',Email\nx,y',
    quote: 'Name,Email\n"unfinished,x',
    nul: 'Name,Email\na,\0',
    rows: 'Name\n' + 'Ada\n'.repeat(101),
    columns: Array.from({ length: 17 }, (_, i) => `h${i}`).join(',') + '\nx',
    cell: 'Name\n' + 'x'.repeat(2049),
    header: 'x'.repeat(81) + '\na',
    size: 'x'.repeat(65537),
  }))
    test(`rejects ${name}`, () => expect(() => parseContacts(bytes(text))).toThrow())
  test('rejects invalid UTF-8', () => expect(() => parseContacts(new Uint8Array([255]))).toThrow())
})

test('known format works in any order and unknown headings ask for mapping', async () => {
  expect(await known({ input: { headers: ['Company', 'Customer', 'Email address'] } })).toEqual(
    completed({ mapping: { name: 1, email: 2, organization: 0 } }),
  )
  expect(await known({ input: { headers: ['Name', 'Email', 'Company'] } })).toEqual(
    completed({ mapping: null }),
  )
})

test('code and mixed agree on reordered known headings', async () => {
  const input = { headers: ['Company', 'Customer', 'Email address'] }
  // The known-format branch needs no child capability.
  await expect(mixed({ input } as Parameters<typeof mixed>[0])).resolves.toEqual(
    await known({ input }),
  )
})

for (const invalid of [
  null,
  { ...mapping, email: 7 },
  { ...mapping, email: 0 },
  { ...mapping, email: -1 },
  { name: 0, email: 1 },
  { ...mapping, extra: 0 },
])
  test(`rejects mapping ${JSON.stringify(invalid)}`, async () => {
    const result = await convert({
      input: { headers, rows: [['Ada', 'ada@example.com', 'Engines']], mapping: invalid },
      signal: signal(),
    })
    expect(result.output).toMatchObject({ status: 'needs_mapping', accepted: [], rejected: [] })
  })
test('checks actual rows, retains record numbers, and never coerces missing cells', async () => {
  const rows = [
    [' Ada ', 'ada@example.com', 'Engines'],
    ['Grace', 'bad', 'Compilers'],
    ['Missing'],
    ['', 'a@example.com', 'Engines'],
  ]
  const result = await convert({ input: { headers, rows, mapping }, signal: signal() })
  expect(result.output).toMatchObject({
    status: 'ready',
    accepted: [
      { record: 2, contact: { name: 'Ada', email: 'ada@example.com', organization: 'Engines' } },
    ],
    rejected: [{ record: 3 }, { record: 4 }, { record: 5 }],
  })
})

test('a structurally valid semantic error remains reviewable, not magically detected', async () => {
  const result = await convert({
    input: {
      headers,
      rows: [['Ada', 'ada@example.com', 'Engines']],
      mapping: { name: 2, email: 1, organization: 0 },
    },
    signal: signal(),
  })
  expect(result.output).toMatchObject({
    status: 'ready',
    mapping: { name: 2, email: 1, organization: 0 },
    accepted: [{ contact: { name: 'Engines', organization: 'Ada' } }],
  })
})

async function withImport(
  work: (run: Parameters<typeof importer>[0], out: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'contact-import-'))
  try {
    await mkdir(join(root, 'source'))
    await mkdir(join(root, 'preview'))
    await writeFile(join(root, 'source/contacts.csv'), await fixture('known'))
    const run = {
      input: {},
      signal: signal(),
      attachments: {
        source: { access: 'read', path: join(root, 'source') },
        preview: { access: 'read-write', path: join(root, 'preview') },
      },
    } as Parameters<typeof importer>[0]
    await work(run, join(root, 'preview/preview.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('all mapper implementations expose the same input and result contracts', async () => {
  const expected = await Bun.file(
    join(import.meta.dir, `../flows/map-code/FLOW.contract.json`),
  ).json()
  for (const method of ['map-agent', 'map-mixed'])
    expect(
      await Bun.file(join(import.meta.dir, `../flows/${method}/FLOW.contract.json`)).json(),
    ).toEqual(expected)
})

test('invalid CSV fails before any child work', async () =>
  withImport(async (run, out) => {
    await writeFile(join(run.attachments.source!.path, 'contacts.csv'), await fixture('malformed'))
    // No child capability exists in this context. Parsing must fail first.
    await expect(importer(run)).rejects.toThrow('headings')
    expect(await Bun.file(out).exists()).toBe(false)
  }))

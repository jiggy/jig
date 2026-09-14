import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import { parseContacts, runMethod as importer } from '../flows/import/method.ts'
import { runMethod as known } from '../flows/map-code/method.ts'
import { runMethod as agent } from '../flows/map-agent/method.ts'
import { runMethod as mixed } from '../flows/map-mixed/method.ts'
import { runMethod as convert } from '../flows/convert/method.ts'

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

for (const selected of [headers, ['Organisation', 'Courriel', 'Nom complet']])
  test(`mixed mapper calls the Agent only for unfamiliar headings (${selected[0]})`, async () => {
    let calls = 0
    const result = await mixed({
      input: { headers: selected },
      callCapability: async () => {
        calls++
        return { outcome: 'completed', structured: mapping }
      },
    })
    expect(result).toEqual(completed({ mapping }))
    expect(calls).toBe(selected === headers ? 0 : 1)
  })
for (const outcome of ['blocked', 'limit'])
  test(`mixed preserves ${outcome} without retry`, async () => {
    let calls = 0
    expect(
      await mixed({
        input: { headers: ['Unknown'] },
        callCapability: async () => {
          calls++
          return { outcome, text: 'Cannot proceed.' }
        },
      }),
    ).toEqual({ outcome, output: { reason: 'Cannot proceed.' } })
    expect(calls).toBe(1)
  })
test('code and mixed agree on reordered known headings', async () => {
  const input = { headers: ['Company', 'Customer', 'Email address'] }
  expect(
    await mixed({
      input,
      callCapability: async () => {
        throw Error('No Agent needed')
      },
    }),
  ).toEqual(await known({ input }))
})

test('Agent request contains headings and structured mapping contract', async () => {
  expect(
    await agent({
      input: { headers },
      callCapability: async (request) => {
        expect(request.slot).toBe('agent')
        expect(request.method).toBe('run')
        expect((request.input as any).instructions).toContain(JSON.stringify({ headers }))
        expect((request.input as any).responseSchema.additionalProperties).toBe(false)
        return { outcome: 'completed', structured: mapping }
      },
    }),
  ).toEqual(completed({ mapping }))
})
for (const outcome of ['blocked', 'limit'])
  test(`Agent preserves ${outcome}`, async () => {
    expect(
      await agent({
        input: { headers },
        callCapability: async () => ({ outcome, text: 'reason' }),
      }),
    ).toEqual({ outcome, output: { reason: 'reason' } })
  })
test('Agent malformed response and execution failure stay errors', async () => {
  await expect(
    agent({ input: { headers }, callCapability: async () => ({ outcome: 'completed' }) }),
  ).rejects.toThrow()
  await expect(
    agent({
      input: { headers },
      callCapability: async () => {
        throw Error('uncertain dispatch')
      },
    }),
  ).rejects.toThrow('uncertain dispatch')
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
      runChildFlow: async () => {
        throw Error('Provide a child')
      },
    } as Parameters<typeof importer>[0]
    await work(run, join(root, 'preview/preview.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('composes public handlers and writes only the complete preview', async () =>
  withImport(async (run, out) => {
    const calls: string[] = []
    run.runChildFlow = async (request) => {
      calls.push(request.slot)
      if (request.slot === 'mapper') {
        expect(Object.keys(request.input as object)).toEqual(['headers'])
        return known({ input: request.input })
      }
      return convert({ input: request.input, signal: run.signal })
    }
    const result = await importer(run)
    expect(calls).toEqual(['mapper', 'converter'])
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(result.output)
    expect((result.output as any).accepted).toHaveLength(2)
    expect((result.output as any).rejected).toHaveLength(1)
  }))
for (const failure of ['blocked', 'limit', 'error', 'cancel'])
  test(`importer preserves ${failure} without publishing or replay`, async () =>
    withImport(async (run, out) => {
      const controller = new AbortController()
      run = { ...run, signal: controller.signal }
      let calls = 0
      run.runChildFlow = async () => {
        calls++
        if (failure === 'error') throw Error('uncertain dispatch')
        if (failure === 'cancel') {
          controller.abort()
          return completed({ mapping })
        }
        return { outcome: failure, output: { reason: 'cannot proceed' } }
      }
      if (failure === 'error' || failure === 'cancel') await expect(importer(run)).rejects.toThrow()
      else expect((await importer(run)).outcome).toBe(failure)
      expect(calls).toBe(1)
      expect(await Bun.file(out).exists()).toBe(false)
    }))

test('all mapper implementations expose the same input and result contracts', async () => {
  for (const schema of ['input', 'result']) {
    const expected = await Bun.file(
      join(import.meta.dir, `../flows/map-code/${schema}.schema.json`),
    ).json()
    for (const method of ['map-agent', 'map-mixed'])
      expect(
        await Bun.file(join(import.meta.dir, `../flows/${method}/${schema}.schema.json`)).json(),
      ).toEqual(expected)
  }
})

test('a converter failure leaves no preview and does not rerun the mapper', async () =>
  withImport(async (run, out) => {
    const calls: string[] = []
    run.runChildFlow = async (request) => {
      calls.push(request.slot)
      if (request.slot === 'mapper') return completed({ mapping })
      throw Error('converter failed')
    }
    await expect(importer(run)).rejects.toThrow('converter failed')
    expect(calls).toEqual(['mapper', 'converter'])
    expect(await Bun.file(out).exists()).toBe(false)
  }))

test('invalid CSV fails before any child work', async () =>
  withImport(async (run, out) => {
    await writeFile(join(run.attachments.source!.path, 'contacts.csv'), await fixture('malformed'))
    let called = false
    run.runChildFlow = async () => {
      called = true
      return completed({ mapping })
    }
    await expect(importer(run)).rejects.toThrow('headings')
    expect(called).toBe(false)
    expect(await Bun.file(out).exists()).toBe(false)
  }))

for (const method of [agent, mixed])
  test('an Agent abstention becomes a null public mapping', async () => {
    expect(
      await method({
        input: { headers: ['Unclear heading'] },
        callCapability: async () => ({
          outcome: 'completed',
          structured: { name: 0, email: null, organization: 2 },
        }),
      }),
    ).toEqual(completed({ mapping: null }))
  })

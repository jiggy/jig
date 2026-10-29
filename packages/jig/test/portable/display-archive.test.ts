import { constants, Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createDisplayBundle,
  type DisplayBundle,
  encodeDisplayBundle,
  type Reference,
} from '@jigging/reporting'
import { canonicalReportingMessage } from '@jigging/reporting/validation'
import {
  openPrivateDisplayArchive,
  PRIVATE_DISPLAY_ARCHIVE_LIMITS,
  type PrivateDisplayArchive,
  type PrivateDisplayArchiveCommit,
} from '../../src/internal/display-archive.js'
import { privatePresentationNow } from '../../src/internal/root-run-timeout-policy.js'

const reference: Reference = { kind: 'artifact', attachment: 'files', path: 'report.txt' }
const bytes = new TextEncoder().encode('Exact originating evidence.\n')
const hash = (input: string | Uint8Array) =>
  `sha256:${createHash('sha256').update(input).digest('hex')}`

async function fixture(work: (archive: PrivateDisplayArchive, directory: string) => Promise<void>) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'jig-display-archive-')))
  const directory = join(parent, 'display')
  const archive = await openPrivateDisplayArchive(directory, { create: true })
  try {
    await work(archive, directory)
  } finally {
    await archive.close()
    await rm(parent, { recursive: true, force: true })
  }
}

async function publication(
  archive: PrivateDisplayArchive,
  requestId = 'publish-1',
  instances = ['album'],
) {
  const { generation, heads } = await archive.state()
  return createDisplayBundle(
    { generation, heads },
    {
      requestId,
      edition: 'Selected edition',
      views: instances.map((instanceKey) => ({
        view: {
          kind: 'view',
          id: instanceKey,
          title: 'Application report',
          summary: instanceKey,
          target: { definitionId: 'photos', instanceKey, subjectKey: instanceKey },
          sections: [
            { blocks: [{ kind: 'report', text: 'Exact evidence.', references: [reference] }] },
          ],
        },
        completeness: 'complete',
        domainRevision: 'domain-1',
      })),
      requiredEvidence: [reference],
    },
  )
}
function input(bundle: DisplayBundle, runId = 'run-1'): PrivateDisplayArchiveCommit {
  return {
    bundle,
    capturedBundleDigest: hash(encodeDisplayBundle(bundle)),
    source: { runId, sourceId: 'root' },
    bindings: [{ reference, state: 'retained', targetId: `capture-${runId}`, content: bytes }],
  }
}
async function tamper(directory: string, action: (database: Database) => void) {
  const database = Database.open(
    join(directory, 'display.sqlite3'),
    constants.SQLITE_OPEN_READWRITE | constants.SQLITE_OPEN_NOFOLLOW,
  )
  try {
    action(database)
  } finally {
    database.close(true)
  }
}

test('one edition atomically retains selected instances and detached exact evidence across reopen', async () =>
  fixture(async (archive, directory) => {
    const bundle = await publication(archive, 'two-instances', ['family', 'spring'])
    const content = Uint8Array.from(bytes)
    const accepted = await archive.commit({
      ...input(bundle),
      bindings: [{ reference, state: 'retained', targetId: 'original', content }],
    })
    content.fill(0)
    expect(accepted.targets).toHaveLength(2)
    expect(new Set(accepted.targets.map((target) => target.revision)).size).toBe(1)
    expect(accepted.source).toEqual({ runId: 'run-1', sourceId: 'root' })
    expect(await archive.views()).toHaveLength(2)
    const evidence = await archive.evidence(
      'photos',
      'family',
      accepted.targets[0]!.revision,
      reference,
    )
    expect(evidence?.content).toEqual(bytes)
    evidence!.content!.fill(0)
    expect(
      (await archive.evidence('photos', 'family', accepted.targets[0]!.revision, reference))
        ?.content,
    ).toEqual(bytes)
    await archive.close()
    const reopened = await openPrivateDisplayArchive(directory)
    try {
      expect(await reopened.receipt(bundle.requestId, bundle.generation)).toEqual(accepted)
      expect(await reopened.views()).toHaveLength(2)
    } finally {
      await reopened.close()
    }
  }))

for (const kind of ['artifact', 'input-artifact', 'call', 'record'])
  test(`a collection text cell named kind containing ${kind} cannot fabricate retained evidence`, async () =>
    fixture(async (archive, directory) => {
      const { generation, heads } = await archive.state()
      const bundle = createDisplayBundle(
        { generation, heads },
        {
          requestId: 'literal-kind',
          edition: 'Literal cell',
          views: [
            {
              view: {
                kind: 'view',
                id: 'literals',
                title: 'Literal cells',
                summary: 'A kind column contains ordinary text.',
                target: { definitionId: 'literals', instanceKey: 'one' },
                sections: [
                  {
                    blocks: [
                      {
                        kind: 'collection',
                        id: 'values',
                        title: 'Values',
                        columns: [{ key: 'kind', label: 'Kind', type: 'text' }],
                        rows: [{ id: 'one', cells: { kind } }],
                      },
                    ],
                  },
                ],
              },
              completeness: 'complete',
            },
          ],
        },
      )
      const accepted = await archive.commit({ ...input(bundle), bindings: [] })
      expect(accepted.evidence).toEqual([])
      expect(await archive.receipt(bundle.requestId, generation)).toEqual(accepted)
      await archive.close()
      const reopened = await openPrivateDisplayArchive(directory)
      try {
        expect(await reopened.receipt(bundle.requestId, generation)).toEqual(accepted)
        expect((await reopened.views())[0]?.publication.view).toEqual(bundle.views[0]?.view)
      } finally {
        await reopened.close()
      }
    }))

test('archive evidence follows every typed view position without interpreting collection cell maps', async () =>
  fixture(async (archive, directory) => {
    const references = [
      { kind: 'artifact', attachment: 'files', path: 'report.txt' },
      { kind: 'input-artifact', attachment: 'source', path: 'fact.txt' },
      { kind: 'artifact', attachment: 'files', path: 'content.txt' },
      { kind: 'record', viewId: 'records', collectionId: 'items', rowId: 'one' },
      { kind: 'call', operationId: 'related' },
      { kind: 'artifact', attachment: 'files', path: 'detail-fact.txt' },
      { kind: 'input-artifact', attachment: 'source', path: 'detail-content.txt' },
    ] as const satisfies readonly Reference[]
    const [report, fact, content, cell, detailReport, detailFact, detailContent] = references
    const { generation, heads } = await archive.state()
    const bundle = createDisplayBundle(
      { generation, heads },
      {
        requestId: 'typed-positions',
        edition: 'Typed positions',
        views: [
          {
            view: {
              kind: 'view',
              id: 'records',
              title: 'Typed evidence',
              summary: 'Only reference positions select evidence.',
              target: { definitionId: 'records', instanceKey: 'one' },
              sections: [
                {
                  blocks: [
                    { kind: 'report', text: 'Report', references: [report] },
                    { kind: 'facts', items: [{ label: 'Fact', value: fact }] },
                    { kind: 'content', reference: content },
                    {
                      kind: 'collection',
                      id: 'items',
                      title: 'Items',
                      columns: [
                        { key: 'kind', label: 'Kind', type: 'text' },
                        { key: 'related', label: 'Related', type: 'reference' },
                      ],
                      rows: [
                        {
                          id: 'one',
                          cells: { kind: 'artifact', related: cell },
                          details: [
                            { kind: 'report', text: 'Detail', references: [detailReport, report] },
                            { kind: 'facts', items: [{ label: 'Detail fact', value: detailFact }] },
                            { kind: 'content', reference: detailContent },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            completeness: 'complete',
          },
        ],
      },
    )
    const accepted = await archive.commit({ ...input(bundle), bindings: [] })
    expect(accepted.evidence.map((item) => item.reference)).toEqual(
      [...references].sort((a, b) =>
        canonicalReportingMessage(a) < canonicalReportingMessage(b) ? -1 : 1,
      ),
    )
    expect(accepted.evidence.every((item) => item.state === 'unavailable')).toBe(true)
    expect(await archive.receipt(bundle.requestId, generation)).toEqual(accepted)
    await archive.close()
    const reopened = await openPrivateDisplayArchive(directory)
    try {
      expect(await reopened.receipt(bundle.requestId, generation)).toEqual(accepted)
    } finally {
      await reopened.close()
    }
  }))

test('request recovery returns original provenance before stale revision checks and never reinstalls removed views', async () =>
  fixture(async (archive) => {
    const bundle = await publication(archive)
    const original = await archive.commit(input(bundle))
    const recovered = await archive.commit(input(bundle, 'another-run'))
    expect(recovered).toEqual(original)
    await archive.remove('photos', 'album', original.targets[0]!.revision)
    expect(await archive.views()).toHaveLength(0)
    expect((await archive.state()).heads[0]?.retained).toBe(false)
    expect(await archive.commit(input(bundle, 'third-run'))).toEqual(original)
    expect(await archive.views()).toHaveLength(0)
    expect(await archive.receipt(bundle.requestId, bundle.generation)).toEqual(original)
  }))

test('same request with changed material or exact evidence refuses without replacing acceptance', async () =>
  fixture(async (archive) => {
    const bundle = await publication(archive)
    const original = await archive.commit(input(bundle))
    await expect(
      archive.commit({
        ...input(bundle),
        bindings: [
          {
            reference,
            state: 'retained',
            targetId: 'changed',
            content: new TextEncoder().encode('Changed'),
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'MISMATCH' })
    await expect(
      archive.commit({ ...input(bundle), bundle: { ...bundle, edition: 'Another edition' } }),
    ).rejects.toMatchObject({ code: 'MISMATCH' })
    expect(await archive.receipt(bundle.requestId, bundle.generation)).toEqual(original)
  }))

test('stale selected target rejects the whole edition and preserves every original head', async () =>
  fixture(async (archive) => {
    const stale = await publication(archive, 'stale', ['family', 'spring'])
    const original = await archive.commit(input(await publication(archive, 'first', ['family'])))
    await expect(archive.commit(input(stale))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await archive.receipt(stale.requestId)).toBeUndefined()
    expect((await archive.views()).map((view) => view.publication.view.target.instanceKey)).toEqual(
      ['family'],
    )
    expect((await archive.state()).heads[0]?.revision).toBe(original.targets[0]?.revision)
  }))

test('removed target revision prevents ABA recreation with null or pre-removal conditions', async () =>
  fixture(async (archive) => {
    const oldCreate = await publication(archive, 'old-create')
    const accepted = await archive.commit(input(await publication(archive, 'accepted')))
    await archive.remove('photos', 'album', accepted.targets[0]!.revision)
    const removed = (await archive.state()).heads[0]!
    expect(removed.retained).toBe(false)
    expect(removed.revision).not.toBe(accepted.targets[0]!.revision)
    await expect(archive.commit(input(oldCreate))).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(
      archive.remove('photos', 'album', accepted.targets[0]!.revision),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await archive.commit(input(await publication(archive, 'recreate')))
    expect(await archive.views()).toHaveLength(1)
  }))

test('explicit generation reset expires old contexts and generation-bound receipts despite reused request IDs', async () =>
  fixture(async (archive) => {
    const old = await publication(archive)
    await archive.commit(input(old))
    const generation = await archive.reset(old.generation)
    expect(generation).not.toBe(old.generation)
    await expect(archive.commit(input(old))).rejects.toMatchObject({ code: 'EXPIRED' })
    await expect(archive.reset(old.generation)).rejects.toMatchObject({ code: 'EXPIRED' })
    const next = await publication(archive)
    await archive.commit(input(next, 'new-generation'))
    await expect(archive.receipt(next.requestId, old.generation)).rejects.toMatchObject({
      code: 'EXPIRED',
    })
    expect((await archive.receipt(next.requestId, generation))?.source.runId).toBe('new-generation')
  }))

test('required evidence refuses acceptance while optional missing evidence remains explicit', async () =>
  fixture(async (archive) => {
    const bundle = await publication(archive)
    await expect(archive.commit({ ...input(bundle), bindings: [] })).rejects.toMatchObject({
      code: 'EVIDENCE_UNAVAILABLE',
    })
    expect((await archive.state()).requests).toBe(0)
    const optional = { ...bundle, requiredEvidence: [] }
    const accepted = await archive.commit({ ...input(optional), bindings: [] })
    expect(accepted.evidence[0]?.state).toBe('unavailable')
    expect(
      await archive.evidence('photos', 'album', accepted.targets[0]!.revision, reference),
    ).toMatchObject({ evidence: { state: 'unavailable' } })
  }))

test('publication deadlines use the inherited epoch clock without accepting expired work', async () =>
  fixture(async (archive) => {
    const bundle = await publication(archive)
    await expect(
      archive.commit({ ...input(bundle), deadline: privatePresentationNow() - 1 }),
    ).rejects.toMatchObject({ code: 'DEADLINE' })
    expect((await archive.state()).requests).toBe(0)
    expect(await archive.receipt(bundle.requestId)).toBeUndefined()
    const accepted = await archive.commit({
      ...input(bundle),
      deadline: privatePresentationNow() + 20_000,
    })
    expect(await archive.receipt(bundle.requestId, bundle.generation)).toEqual(accepted)
    await expect(
      archive.commit({ ...input(bundle), deadline: performance.now() + 0.5 }),
    ).rejects.toMatchObject({ code: 'INVALID' })
  }))

test('independent owners serialize competing writes and preserve exactly one CAS winner', async () =>
  fixture(async (archive, directory) => {
    const other = await openPrivateDisplayArchive(directory)
    try {
      const a = await publication(archive, 'a')
      const b = await publication(other, 'b')
      const results = await Promise.allSettled([
        archive.commit(input(a)),
        other.commit(input(b, 'run-2')),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const refused = results.find((result) => result.status === 'rejected')
      expect(refused).toMatchObject({ reason: { code: 'CONFLICT' } })
      expect((await archive.state()).requests).toBe(1)
    } finally {
      await other.close()
    }
  }))

test('scoped reads apply selection before the 32-view presentation limit and disclose heads separately', async () =>
  fixture(async (archive) => {
    await archive.commit(
      input(
        await publication(
          archive,
          'first',
          Array.from({ length: 20 }, (_, index) => `a${index.toString().padStart(2, '0')}`),
        ),
      ),
    )
    await archive.commit(
      input(
        await publication(
          archive,
          'second',
          Array.from({ length: 20 }, (_, index) => `z${index.toString().padStart(2, '0')}`),
        ),
      ),
    )
    expect((await archive.state()).heads).toHaveLength(40)
    expect(await archive.views()).toHaveLength(32)
    expect(
      (await archive.views({ definitionId: 'photos', instanceKey: 'z19' })).map(
        (view) => view.publication.view.target.instanceKey,
      ),
    ).toEqual(['z19'])
    expect(await archive.views({ definitionId: 'unknown' })).toHaveLength(0)
    await expect(archive.views({ limit: 33 })).rejects.toMatchObject({ code: 'INVALID' })
  }))

test('changed evidence bytes and oversized stored blobs refuse before exposure', async () =>
  fixture(async (archive, directory) => {
    const bundle = await publication(archive)
    const accepted = await archive.commit(input(bundle))
    await tamper(directory, (database) =>
      database
        .query('UPDATE display_blobs SET content = ?1')
        .run(new TextEncoder().encode('Changed')),
    )
    await expect(
      archive.evidence('photos', 'album', accepted.targets[0]!.revision, reference),
    ).rejects.toMatchObject({ code: 'UNSAFE_STORE' })
    await tamper(directory, (database) =>
      database.exec(
        `UPDATE display_blobs SET content = zeroblob(${PRIVATE_DISPLAY_ARCHIVE_LIMITS.evidenceFileBytes + 1})`,
      ),
    )
    await expect(
      archive.evidence('photos', 'album', accepted.targets[0]!.revision, reference),
    ).rejects.toMatchObject({ code: 'UNSAFE_STORE' })
  }))

const corruptReceipts: readonly [string, (value: any) => void][] = [
  [
    'unknown field',
    (value) => {
      value.unexpected = true
    },
  ],
  [
    'missing captured digest',
    (value) => {
      delete value.capturedBundleDigest
    },
  ],
  [
    'invalid captured digest',
    (value) => {
      value.capturedBundleDigest = 'sha256:bad'
    },
  ],
  [
    'missing source',
    (value) => {
      delete value.source
    },
  ],
  [
    'unknown source field',
    (value) => {
      value.source.path = '/private'
    },
  ],
  [
    'invalid source ID',
    (value) => {
      value.source.runId = 1
    },
  ],
  [
    'empty targets',
    (value) => {
      value.targets = []
    },
  ],
  [
    'duplicate targets',
    (value) => {
      value.targets.push(value.targets[0])
    },
  ],
  [
    'foreign generation revision',
    (value) => {
      value.targets[0].revision = 'foreign:1'
    },
  ],
  [
    'future revision',
    (value) => {
      value.targets[0].revision = `${value.generation}:999999`
    },
  ],
  [
    'unknown target field',
    (value) => {
      value.targets[0].source = 'forged'
    },
  ],
  [
    'missing evidence',
    (value) => {
      delete value.evidence
    },
  ],
  [
    'duplicate evidence',
    (value) => {
      value.evidence.push(value.evidence[0])
    },
  ],
  [
    'invalid evidence bytes',
    (value) => {
      value.evidence[0].bytes = -1
    },
  ],
  [
    'invalid evidence reference',
    (value) => {
      value.evidence[0].reference = { kind: 'unknown' }
    },
  ],
]
for (const [name, change] of corruptReceipts)
  test(`canonical persisted receipt with ${name} refuses lookup and deduplication`, async () =>
    fixture(async (archive, directory) => {
      const bundle = await publication(archive)
      const accepted = await archive.commit(input(bundle))
      const value = JSON.parse(JSON.stringify(accepted))
      change(value)
      await tamper(directory, (database) =>
        database
          .query('UPDATE display_requests SET receipt = ?1')
          .run(canonicalReportingMessage(value)),
      )
      await expect(archive.receipt(bundle.requestId, bundle.generation)).rejects.toMatchObject({
        code: 'UNSAFE_STORE',
      })
      await expect(archive.commit(input(bundle))).rejects.toMatchObject({ code: 'UNSAFE_STORE' })
    }))

for (const sql of [
  'CREATE TRIGGER unexpected AFTER INSERT ON display_requests BEGIN SELECT 1; END',
  'CREATE VIEW sqlitex_extra AS SELECT 1',
  'CREATE INDEX unexpected ON display_views (definition_id)',
])
  test(`archive acquisition refuses extra owned schema object ${sql.split(' ')[1]}`, async () =>
    fixture(async (archive, directory) => {
      await archive.close()
      await tamper(directory, (database) => database.exec(sql))
      await expect(openPrivateDisplayArchive(directory)).rejects.toMatchObject({
        code: 'UNSAFE_STORE',
      })
    }))

test('archive acquisition refuses links and unsafe owner permissions', async () =>
  fixture(async (archive, directory) => {
    await archive.close()
    const linked = `${directory}-link`
    await symlink(directory, linked)
    try {
      await expect(openPrivateDisplayArchive(linked)).rejects.toBeDefined()
    } finally {
      await rm(linked)
    }
    await chmod(directory, 0o755)
    try {
      await expect(openPrivateDisplayArchive(directory)).rejects.toMatchObject({
        code: 'UNSAFE_STORE',
      })
    } finally {
      await chmod(directory, 0o700)
    }
  }))

test(
  'receipt ledger refuses new publication at capacity while accepted recovery remains available',
  async () =>
    fixture(async (archive) => {
      let first: DisplayBundle | undefined
      let accepted: unknown
      for (let index = 0; index < PRIVATE_DISPLAY_ARCHIVE_LIMITS.requests; index++) {
        const bundle = await publication(archive, `request-${index}`)
        const result = await archive.commit(input(bundle))
        if (index === 0) {
          first = bundle
          accepted = result
        }
      }
      await expect(
        archive.commit(input(await publication(archive, 'overflow'))),
      ).rejects.toMatchObject({ code: 'CAPACITY' })
      expect(await archive.commit(input(first!))).toEqual(accepted)
      expect((await archive.state()).requests).toBe(PRIVATE_DISPLAY_ARCHIVE_LIMITS.requests)
    }),
  120_000,
)

test('closing joins accepted work, is memoized, and prevents later operations', async () =>
  fixture(async (archive) => {
    const pending = archive.commit(input(await publication(archive)))
    const closing = archive.close()
    expect(archive.close()).toBe(closing)
    await pending
    await closing
    await expect(archive.state()).rejects.toMatchObject({ code: 'CLOSED' })
  }))

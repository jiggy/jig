// Inert observations for mounted-browser acceptance, not native execution evidence.
// Application pages use the ordinary example projectors rather than a second UI.
import { deflateSync } from 'node:zlib'
import { validateDisplaySnapshot } from '@jigging/display-model'
import {
  contactPreviewOptions,
  contactPreviewView,
} from '../../../examples/contact-import/flows/import/dashboard.ts'
import { rosterCsv } from '../../../examples/kitchen-roster/flows/export-roster/csv.ts'
import { checkRoster } from '../../../examples/kitchen-roster/flows/check-roster/policy.ts'
import {
  rosterView,
  rosterViewOptions,
} from '../../../examples/kitchen-roster/flows/roster/view.ts'
import {
  factoryViewOptions,
  patchesView,
} from '../../../examples/software-factory/flows/factory/dashboard.ts'
import {
  supportCaseOptions,
  supportCaseView,
} from '../../../examples/support-case/flows/resolve/dashboard.ts'
import {
  patchReviewOptions,
  patchReviewView,
} from '../../../examples/tested-patch/flows/project/dashboard.ts'

const observedAt = Date.UTC(2026, 0, 1)
export const patchText =
  '--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1 +1 @@\n-const count = 1\n+const count = 2\n'

export function snapshot(views = []) {
  return {
    kind: 'snapshot',
    revision: 1,
    mode: 'live-run',
    rootSourceId: 'root',
    workspace: {
      target: 'binding:acceptance',
      phase: 'settled',
      hostStage: 'Closed',
      elapsedMs: 70000,
    },
    context: '',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views,
    calls: [],
    activities: [],
    attention: [],
    journal: [],
    artifacts: {
      generation: 'output-1',
      sourceId: 'root',
      permittedAttachments: ['preview', 'deliverables', 'files'],
      provenance: 'verified-delivery',
      phase: 'ready',
      files: [],
    },
  }
}

export function view(id, options, value, sourceId = 'root') {
  return {
    id,
    sourceId,
    sourceLabel: sourceId === 'root' ? 'Application' : 'Repair specialist',
    updatedAt: observedAt,
    value: { kind: 'view', id, ...options, ...value },
  }
}

export function hostFixture() {
  const body = snapshot([
    view(
      'root',
      { title: 'Application', application: 'Acceptance workbench', landing: true },
      {
        summary: 'Read the supplied material.',
        sections: [
          { blocks: [{ kind: 'report', text: 'A complete report without mandatory selection.' }] },
        ],
      },
    ),
  ])
  body.calls = [
    {
      id: 'group',
      sourceId: 'root',
      sourceLabel: 'Application',
      childSourceId: 'child',
      operationId: 'group',
      slot: 'group',
      intent:
        'Group the supplied photographs into checked events without granting access to their original files',
      state: 'returned',
      firstObservedAt: observedAt,
      observedAt: observedAt + 24000,
    },
    {
      id: 'agent',
      sourceId: 'child',
      sourceLabel: 'Grouping specialist',
      parentId: 'group',
      operationId: 'caption-task',
      slot: 'agent',
      intent: 'Read the supplied captions and return a grouping proposal',
      state: 'returned',
      firstObservedAt: observedAt + 1000,
      observedAt: observedAt + 20000,
    },
    {
      id: 'copy',
      sourceId: 'root',
      sourceLabel: 'Application',
      operationId: 'copy',
      slot: 'copy',
      intent: 'Copy the original photographs into verified event folders',
      state: 'returned',
      firstObservedAt: observedAt + 25000,
      observedAt: observedAt + 31000,
    },
  ]
  body.journal = [
    {
      id: 'notice',
      kind: 'flow',
      attribution: {
        provenance: 'accepted-source',
        sourceId: 'child',
        sourceLabel: 'Grouping specialist',
        relation: 'observed-call',
        callId: 'group',
        ancestryIncomplete: false,
      },
      sequence: 1,
      importance: 'info',
      text: 'The caption proposal has been checked. Source photographs remain unchanged.',
    },
    {
      id: 'diagnostic',
      kind: 'diagnostic',
      attribution: { provenance: 'host-observed', sourceLabel: 'Host' },
      sequence: 2,
      importance: 'warning',
      text: 'Synthetic diagnostic for evidence inspection. No work was restarted.',
    },
  ]
  return checked({
    snapshot: body,
    captures: { 'review.patch': { text: patchText, attachment: 'deliverables' } },
  })
}

export function contactFixture() {
  const headers = ['Customer', 'Email address', 'Company']
  const rows = [
    ['Ada Lovelace', 'ada@example.com', 'Analytical Engines'],
    ['Lin, Mei', 'mei@example.com', 'Example, Ltd'],
  ]
  const preview = {
    status: 'ready',
    reason: 'Review the mapping and contacts before importing.',
    mapping: { name: 0, email: 1, organization: 2 },
    accepted: rows.map((row, index) => ({
      record: index + 2,
      contact: { name: row[0], email: row[1], organization: row[2] },
    })),
    rejected: [{ record: 4, reason: 'Email does not match the required format.' }],
  }
  const body = snapshot([
    view(
      'contacts',
      contactPreviewOptions(headers, [...rows, ['Needs correction', 'invalid-address', 'Example']]),
      contactPreviewView({ phase: 'ready', headers, records: 3, preview, file: 'preview.json' }),
    ),
  ])
  return checked({
    snapshot: body,
    captures: { 'preview.json': { attachment: 'preview', text: JSON.stringify(preview, null, 2) } },
  })
}

export function supportFixture() {
  const input = {
    message: `Please explain the duplicate payment. ${'The full customer request stays readable. '.repeat(60)}END OF CUSTOMER REQUEST`,
    account: {
      id: 'account-1',
      charges: [
        { id: 'charge-1', invoiceId: 'invoice-1', amountCents: 2400, status: 'settled' },
        { id: 'charge-2', invoiceId: 'invoice-1', amountCents: 2400, status: 'settled' },
      ],
    },
  }
  return checked({
    snapshot: snapshot([
      view(
        'support',
        supportCaseOptions(input),
        supportCaseView({
          phase: 'ready',
          input,
          proposal: { chargeId: 'charge-2', requestedCreditCents: 2400 },
          decision: {
            accountId: 'account-1',
            disposition: 'credit_eligible',
            reason: 'verified_duplicate',
            reply: 'The duplicate is eligible for review. No credit has been issued.',
            credit: { chargeId: 'charge-2', amountCents: 2400 },
          },
        }),
      ),
    ]),
    captures: {},
  })
}

export function kitchenFixture() {
  const scenario = {
    shifts: Array.from({ length: 4 }, (_, index) => ({
      id: `shift-${index}`,
      from: 540 + index * 60,
      until: 600 + index * 60,
    })),
    volunteers: ['Ada', 'Lin', 'Grace', 'Iris', 'Sam', 'Noor'].map((name, index) => ({
      id: `person-${index}`,
      name,
      roles: ['cook', 'serve'],
      available: [{ from: 540, until: 780 }],
      maxMinutes: 240,
      preference: 'Any shift',
    })),
  }
  const assignments = checkRoster(scenario, {
    status: 'proposed',
    reason: '',
    assignments: scenario.shifts.flatMap((shift) =>
      ['cook', 'serve'].map((role, index) => ({
        shiftId: shift.id,
        role,
        volunteerId: `person-${index}`,
      })),
    ),
  })
  if (typeof assignments === 'string') throw new Error('The fixture requires a checked roster.')
  return checked({
    snapshot: snapshot([
      view(
        'kitchen',
        rosterViewOptions(scenario),
        rosterView({ phase: 'ready', scenario, assignments }),
      ),
    ]),
    captures: {
      'roster.csv': { attachment: 'schedule', text: rosterCsv(assignments) },
    },
  })
}

export function patchFixture() {
  const input = {
    issue: 'Correct the count without applying the proposed change.',
    editPaths: ['src/example.ts'],
    files: { 'src/example.ts': 'const count = 1\n' },
    cases: [{ id: 'correct count' }],
  }
  const baseline = {
    repositoryTestsPassed: false,
    accepted: false,
    acceptance: [{ id: 'correct count', passed: false }],
  }
  const accepted = {
    repositoryTestsPassed: true,
    accepted: true,
    acceptance: [{ id: 'correct count', passed: true }],
  }
  const checkedRepair = {
    ready: true,
    reason: 'The proposed patch passed the independent checks.',
    baseline,
    attempts: [{ evaluation: accepted }],
    proposals: [
      { number: 1, replacements: [{ path: 'src/example.ts', content: 'const count = 2\n' }] },
    ],
  }
  const body = snapshot([
    view(
      'patch',
      patchReviewOptions(input),
      patchReviewView({
        phase: 'ready',
        request: input,
        captured: input,
        checked: checkedRepair,
        files: ['review/review.patch', 'review/summary.txt'],
      }),
    ),
  ])
  return checked({
    snapshot: body,
    captures: {
      'review/review.patch': { attachment: 'deliverables', text: patchText },
      'review/summary.txt': {
        attachment: 'deliverables',
        text: 'Independent checks passed. Changes have not been applied.',
      },
    },
  })
}

export function factoryFixture() {
  const input = {
    issue: 'Correct the count.',
    editPaths: ['src/example.ts'],
    files: { 'src/example.ts': 'const count = 1\n' },
    cases: [{ id: 'correct count' }],
  }
  const prepared = [{ job: { id: 'count', label: 'Correct count', directory: 'count' }, input }]
  const options = factoryViewOptions(prepared)
  const outcomes = {
    count: {
      ready: true,
      verification: {
        proposal: 1,
        changedPaths: ['src/example.ts'],
        acceptanceCases: ['correct count'],
      },
    },
  }
  return checked({
    snapshot: snapshot([
      view('factory', { ...options.patches, landing: true }, patchesView(prepared, outcomes)),
    ]),
    captures: {
      'count/review.patch': { attachment: 'deliverables', text: patchText },
      'count/goal.txt': { attachment: 'deliverables', text: input.issue },
      'summary.txt': {
        attachment: 'deliverables',
        text: 'The count patch is available for review.',
      },
    },
  })
}

export function childFixture() {
  const fixture = hostFixture()
  fixture.snapshot.views.push(
    view(
      'child-review',
      {
        title: 'Specialist material',
        target: { definitionId: 'specialist', instanceKey: 'case', label: 'Checked repair' },
      },
      {
        summary: 'A child projection keeps its complete material.',
        sections: [
          {
            title: 'Checked candidates',
            blocks: [
              {
                kind: 'collection',
                id: 'candidates',
                title: 'Candidates',
                columns: [
                  { key: 'name', label: 'Candidate', type: 'text' },
                  { key: 'status', label: 'Status', type: 'text' },
                  { key: 'source', label: 'Source', type: 'text' },
                  { key: 'extra', label: 'Complete fourth field', type: 'text' },
                ],
                rows: [
                  {
                    id: 'a',
                    cells: {
                      name: 'Alpha',
                      status: 'Checked',
                      source: 'Original',
                      extra: 'VISIBLE FOURTH FIELD',
                    },
                    details: [{ kind: 'report', text: 'Details belong to Alpha.' }],
                  },
                  {
                    id: 'b',
                    cells: {
                      name: 'Beta',
                      status: 'Checked',
                      source: 'Proposal',
                      extra: 'Another complete field',
                    },
                    details: [{ kind: 'report', text: 'Details belong to Beta.' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      'child',
    ),
  )
  return checked(fixture)
}

export function documentFixture() {
  const image = portraitImage()
  const body = snapshot([
    view(
      'document',
      { title: 'Document', application: 'Acceptance workbench', landing: true },
      {
        summary: 'Read the complete portrait cover and captured patch.',
        presentation: {
          kind: 'document',
          title: 'Portrait evidence',
          cover: { kind: 'artifact', attachment: 'files', path: 'cover.png' },
        },
        sections: [
          {
            title: 'Captured patch',
            blocks: [
              {
                kind: 'content',
                title: 'Patch evidence',
                reference: { kind: 'artifact', attachment: 'deliverables', path: 'review.patch' },
              },
            ],
          },
        ],
      },
    ),
  ])
  return checked({
    snapshot: body,
    captures: {
      'review.patch': { attachment: 'deliverables', text: patchText },
      'cover.png': {
        attachment: 'files',
        bytes: image,
        image: { mime: 'image/png', width: 32, height: 64, base64: image.toString('base64') },
      },
    },
  })
}

function portraitImage() {
  const width = 32,
    height = 64
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      const offset = row * (width * 4 + 1) + 1 + column * 4
      pixels[offset] = row < height / 2 ? 255 : 0
      pixels[offset + 1] = row < height / 2 ? 0 : 255
      pixels[offset + 3] = 255
    }
  const chunk = (type, bytes) => {
    const content = Buffer.concat([Buffer.from(type), bytes])
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
    const result = Buffer.alloc(bytes.length + 12)
    result.writeUInt32BE(bytes.length)
    content.copy(result, 4)
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function checked(fixture) {
  fixture.snapshot.artifacts.files = []
  for (const [path, capture] of Object.entries(fixture.captures)) {
    capture.bytes ??= Buffer.from(capture.text)
    const id = `capture-${fixture.snapshot.artifacts.files.length}`
    fixture.snapshot.artifacts.files.push({
      id,
      path,
      sourceId: 'root',
      attachment: capture.attachment,
      bytes: capture.bytes.length,
      state: capture.image ? 'image' : 'text',
      clipped: false,
      downloadable: true,
    })
    if (!fixture.snapshot.artifacts.permittedAttachments.includes(capture.attachment))
      fixture.snapshot.artifacts.permittedAttachments.push(capture.attachment)
    capture.id = id
  }
  validateDisplaySnapshot(fixture.snapshot)
  return fixture
}

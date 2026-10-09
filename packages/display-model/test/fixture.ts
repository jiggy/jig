import type { DisplaySnapshot } from '@jigging/display-model'

/** Consumer-owned semantic data; no Jig publisher, capture or execution object. */
export function fixture(): DisplaySnapshot {
  return {
    kind: 'snapshot',
    revision: 1,
    mode: 'live-run',
    rootSourceId: 'source-root',
    workspace: {
      target: 'Review supplied evidence',
      phase: 'settled',
      hostStage: 'Done',
      elapsedMs: 10,
      facts: {
        execution: { value: 'succeeded', provenance: 'host-observed' },
        application: { value: 'needs-review', provenance: 'application-reported' },
        cleanup: { value: 'complete', provenance: 'host-observed' },
        delivery: { value: 'written', provenance: 'host-observed' },
        completeness: { value: 'observation ended', provenance: 'host-observed' },
      },
    },
    context: 'Reports are literal application claims',
    omissions: { calls: 0, journal: { flow: 0, host: 0, diagnostic: 0 } },
    views: [
      {
        id: 'view-root',
        sourceId: 'source-root',
        sourceLabel: 'Root method',
        updatedAt: 10,
        value: {
          kind: 'view',
          id: 'findings',
          title: 'Findings',
          summary: 'Supplied report',
          sections: [
            {
              blocks: [
                {
                  kind: 'collection',
                  id: 'records',
                  title: 'Records',
                  columns: [
                    { key: 'name', label: 'Name', type: 'text' },
                    { key: 'evidence', label: 'Evidence', type: 'reference' },
                  ],
                  rows: [
                    {
                      id: 'one',
                      cells: {
                        name: 'Finding',
                        evidence: { kind: 'artifact', attachment: 'output', path: 'notes.txt' },
                      },
                      details: [{ kind: 'report', text: 'Requires independent review' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
    calls: [
      {
        id: 'call-root',
        sourceId: 'source-root',
        sourceLabel: 'Root method',
        operationId: 'worker',
        childSourceId: 'source-child',
        slot: 'check',
        state: 'uncertain',
        firstObservedAt: 1,
        observedAt: 10,
        cause: 'No confirmed answer',
      },
    ],
    activities: [],
    journal: [],
    attention: [
      {
        id: 'cause',
        attribution: { provenance: 'host-observed', sourceLabel: 'Host', callId: 'call-root' },
        priority: 4,
        text: 'No confirmed answer',
        transcriptCommitted: false,
      },
    ],
    artifacts: {
      generation: 'capture-one',
      sourceId: 'source-root',
      permittedAttachments: ['output'],
      provenance: 'verified-delivery',
      phase: 'ready',
      files: [{ id: 'artifact-one', path: 'notes.txt', bytes: 12, state: 'text', clipped: false }],
    },
  }
}

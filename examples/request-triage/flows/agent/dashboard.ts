import type { RunResult } from '@jigging/flow'
import type { ViewSnapshot } from '@jigging/user-updates'

export function triageView(message: string, approach: string, result?: RunResult): ViewSnapshot {
  const output = result?.output as
    | { queue?: 'billing' | 'technical' | 'manual'; reason?: string }
    | undefined
  const reason = [...(output?.reason ?? '')].slice(0, 512).join('')
  const queues: Record<'billing' | 'technical' | 'manual', string> = {
    billing: 'Billing',
    technical: 'Technical support',
    manual: 'Manual review',
  }
  const queue = output?.queue ? queues[output.queue] : 'No queue reported'
  return {
    summary: result
      ? result.outcome === 'done'
        ? `Suggested queue: ${queue}. No request has been dispatched.`
        : `Classification ${result.outcome}; no queue was selected.`
      : 'Suggest a support queue for this request. The suggestion does not dispatch work.',
    sections: [
      {
        title: 'Requested work',
        blocks: [
          { kind: 'report', text: message },
          { kind: 'report', text: approach },
        ],
      },
      {
        title: 'Suggestion',
        blocks:
          result?.outcome === 'done'
            ? [
                {
                  kind: 'facts',
                  items: [
                    { label: 'Suggested queue', value: queue },
                    {
                      label: 'Business action',
                      value: 'None; the consuming application decides what happens next.',
                    },
                  ],
                },
              ]
            : [
                {
                  kind: 'report',
                  text: result
                    ? `Reported reason (bounded excerpt): ${reason || 'No reason supplied.'} The complete result retains the reported cause.`
                    : 'Waiting for the selected method; no suggestion is available yet.',
                },
              ],
      },
    ],
  }
}

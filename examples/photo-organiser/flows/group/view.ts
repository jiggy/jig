import type { ViewSnapshot } from '@jigging/reporting'

export function groupingView(photoCount: number, proposalReturned = false): ViewSnapshot {
  let summary = `Proposing events for ${photoCount} captions. The caller checks assignments before writing files.`
  let explanation =
    'This Flow has no file attachments. Captions and dates go to the configured Agent; photo bytes do not.'

  if (proposalReturned) {
    summary = 'Proposal returned. The caller still checks every ID and destination.'
    explanation = 'Event suggestions are provisional until the organiser accepts them.'
  }

  return {
    summary,
    sections: [{ blocks: [{ kind: 'report', text: explanation }] }],
  }
}

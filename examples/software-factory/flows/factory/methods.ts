/** Reviewed application policy. Ticket text cannot supply or replace this map. */
export const methods = [
  {
    id: 'p1',
    slot: 'single-pass',
    description:
      'Repair a small Bun project with one source proposal, checked against fixed repository tests and independent acceptance cases. ' +
      'Stop if it fails; no correction. Suitable when the requester wants a bounded first attempt, limits proposal work to one pass, or prioritizes avoiding another proposal call. ' +
      'Produces a patch for human review only; cannot apply, merge, release, or change acceptance policy.',
  },
  {
    id: 'p2',
    slot: 'checked-correction',
    description:
      'Repair a small Bun project with a checked source proposal and, if necessary, one correction using observed check feedback. ' +
      'Use when the requester wants a chance to correct a failed attempt and accepts up to two proposals; default for repair work with no preference. ' +
      'Uses the same fixed repository tests and independent acceptance cases. Produces a patch for human review only; cannot apply, merge, release, or change acceptance policy.',
  },
] as const

export const candidates = methods.map(({ id, description }) => ({ id, description }))

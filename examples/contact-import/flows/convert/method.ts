import type { RunContext, RunResult } from '@jigging/flow'

type Mapping = { name: number; email: number; organization: number }
export async function runMethod(run: Pick<RunContext, 'input' | 'signal'>): Promise<RunResult> {
  const { headers, rows, mapping } = run.input as {
    headers: string[]
    rows: string[][]
    mapping: Mapping | null
  }
  run.signal.throwIfAborted()
  const fields = ['name', 'email', 'organization'] as const
  if (
    !mapping ||
    Object.keys(mapping).sort().join(',') !== 'email,name,organization' ||
    fields.some(
      (k) => !Number.isInteger(mapping[k]) || mapping[k] < 0 || mapping[k] >= headers.length,
    ) ||
    new Set(fields.map((k) => mapping[k])).size !== 3
  )
    return {
      outcome: 'done',
      output: {
        status: 'needs_mapping',
        reason: 'Choose three distinct existing columns.',
        mapping: null,
        accepted: [],
        rejected: [],
      },
    }

  const accepted: {
    record: number
    contact: { name: string; email: string; organization: string }
  }[] = []
  const rejected: { record: number; reason: string }[] = []
  for (const [index, row] of rows.entries()) {
    // Record numbers include the header; quoted newlines do not start a new record.
    const record = index + 2
    const contact = {
      name: row[mapping.name]?.trim() ?? '',
      email: row[mapping.email]?.trim() ?? '',
      organization: row[mapping.organization]?.trim() ?? '',
    }
    const reason =
      row.length !== headers.length
        ? 'Column count does not match the header.'
        : !contact.name || !contact.organization
          ? 'Name and organization are required.'
          : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)
            ? 'Email does not match this example’s basic format rule.'
            : ''
    if (reason) rejected.push({ record, reason })
    else accepted.push({ record, contact })
  }
  return {
    outcome: 'done',
    output: {
      status: 'ready',
      reason: 'Review the mapping and contacts before importing.',
      mapping,
      accepted,
      rejected,
    },
  }
}

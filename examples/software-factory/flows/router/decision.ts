export interface Candidate {
  id: string
  description: string
}
export interface RoutingInput {
  task: string
  candidates: Candidate[]
}
export type RoutingResult =
  | { outcome: 'done'; output: { candidateId: string | null; reason: string } }
  | { outcome: 'blocked' | 'limit'; output: { reason: string } }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Expected a routing object.')
  return value as Record<string, unknown>
}
function keys(value: object, expected: string[]) {
  if (Object.keys(value).sort().join(',') !== expected.sort().join(','))
    throw new TypeError('Unexpected or missing routing fields.')
}
function text(value: unknown, bytes: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value) > bytes ||
    Buffer.from(value).toString('utf8') !== value ||
    value.includes('\0')
  )
    throw new TypeError('Supply nonempty bounded Unicode routing text without NUL.')
  return value
}

/** Check and snapshot all candidate data before any Agent work. */
export function routingInput(value: unknown): RoutingInput {
  const input = object(value)
  keys(input, ['task', 'candidates'])
  const task = text(input.task, 16000)
  if (!Array.isArray(input.candidates) || input.candidates.length > 16)
    throw new TypeError('Supply at most 16 eligible candidates.')
  const candidates = Array.from(input.candidates, (value) => {
    const candidate = object(value)
    keys(candidate, ['id', 'description'])
    const id = text(candidate.id, 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id))
      throw new TypeError('Candidate IDs must be opaque ASCII identifiers.')
    return { id, description: text(candidate.description, 4000) }
  })
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new TypeError('Candidate IDs must be distinct.')
  if (Buffer.byteLength(JSON.stringify({ task, candidates })) > 32768)
    throw new TypeError('Routing input exceeds 32 KiB.')
  return { task, candidates }
}

/** Consumers use this boundary check even when replacing the router Flow. */
export function checkRoutingResult(
  value: unknown,
  candidates: readonly Candidate[],
): RoutingResult {
  const result = object(value)
  keys(result, ['outcome', 'output'])
  const output = object(result.output)
  if (result.outcome === 'blocked' || result.outcome === 'limit') {
    keys(output, ['reason'])
    return { outcome: result.outcome, output: { reason: text(output.reason, 2000) } }
  }
  keys(output, ['candidateId', 'reason'])
  if (
    result.outcome !== 'done' ||
    (output.candidateId !== null &&
      !candidates.some((candidate) => candidate.id === output.candidateId))
  )
    throw new TypeError('The router did not return an eligible candidate or explicit abstention.')
  return {
    outcome: 'done',
    output: { candidateId: output.candidateId as string | null, reason: text(output.reason, 2000) },
  }
}

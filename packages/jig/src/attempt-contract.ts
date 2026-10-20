import { createHash } from 'node:crypto'
import { canonicalJson, decodeJson1, type JsonValue, validateJson1 } from './json.js'

export const ATTEMPT_REQUEST_BYTES = 1_048_576
export const ATTEMPT_FRAME_BYTES = 16_777_216
export const ATTEMPT_STDERR_BYTES = 65_536
export const ATTEMPT_DIAGNOSTIC_TEXT_BYTES = 3 * ATTEMPT_STDERR_BYTES
export const ATTEMPT_PROTOCOL_VERSION = 1
export type AttemptVerb =
  | 'inspect'
  | 'prepare'
  | 'submit'
  | 'lookup'
  | 'cancel'
  | 'result'
  | 'export'
export interface AttemptConstraints {
  durationMs: number
  resultBytes: number
  artifactBytes: number
}
export interface AttemptOutputIntent {
  packet: boolean
  receive: string[]
}
export interface CanonicalRequest {
  expectedApproval: string
  target: string
  input: JsonValue
  files: { port: string; manifestDigest: string; bytes: number }[]
  constraints: AttemptConstraints
  outputIntent: AttemptOutputIntent
}
export interface PrepareRequest extends Omit<CanonicalRequest, 'files'> {
  files: { port: string; source: string; selection: string[] }[]
}
export interface Prepared {
  ticket: string
  requestDigest: string
  submitBefore: string
  retainUntil: string
  canonicalRequest: CanonicalRequest
}
export interface ArtifactAvailability {
  name: string
  manifestDigest?: string
  availability: 'pending' | 'available' | 'expired' | 'unavailable'
}
export interface AttemptReceipt {
  runId: string
  requestDigest: string
  acceptedAt: string
  target: string
  approval: string
  artifactResults: ArtifactAvailability[]
}
export const ATTEMPT_FAILURE_CODES = [
  'CANCELLED',
  'DEADLINE_EXCEEDED',
  'OWNER_CLOSED',
  'OPERATION_CONFLICT',
  'UNAVAILABLE',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'INVALID_INPUT',
  'INVALID_RESULT',
  'UNCERTAIN',
  'EXECUTION_FAILED',
  'REVIEW_REQUIRED',
  'PROTOCOL_ERROR',
  'CHANNEL_LOST',
  'LAGGED',
  'DISCONNECTED',
] as const
export const ATTEMPT_ERROR_CODES = [
  'INVALID_REQUEST',
  'REQUEST_CONFLICT',
  'APPROVAL_CHANGED',
  'TICKET_EXPIRED',
  'TICKET_INVALID',
  'IDENTITY_UNAVAILABLE',
  'EXECUTION_UNCERTAIN',
  'CLEANUP_UNRESOLVED',
  'UNAVAILABLE',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'PROJECT_BUSY',
  'INTERNAL',
] as const
export type AttemptErrorCode = (typeof ATTEMPT_ERROR_CODES)[number]
export interface AttemptDiagnostics {
  stderr: string
  stderrBytes: number
  stderrTruncated: boolean
}
export type AttemptTerminal =
  | { status: 'succeeded'; outcome: string; resultDigest: string; diagnostics: AttemptDiagnostics }
  | {
      status: 'failed'
      code: (typeof ATTEMPT_FAILURE_CODES)[number]
      message: string
      details?: JsonValue
      diagnostics: AttemptDiagnostics
    }
  | { status: 'lost'; code: 'COORDINATOR_LOST'; message: string }
export interface AttemptObservation {
  identity: 'prepared' | 'accepted' | 'retired' | 'unavailable'
  dispatch: 'not-dispatched' | 'possible' | 'confirmed'
  receipt?: AttemptReceipt
  execution?: 'accepted' | 'running' | 'terminal' | 'uncertain'
  terminal?: AttemptTerminal
  cleanup?: 'pending' | 'confirmed' | 'unresolved'
  retained?: 'available' | 'expired' | 'unavailable'
  reason?: AttemptErrorCode
}
export interface AttemptCheckpoint {
  availability: 'available' | 'expired' | 'unavailable'
  sequence?: number
  digest?: string
  evidence?: JsonValue
  files?: Readonly<Record<string, string>>
  artifactResults: ArtifactAvailability[]
}
export interface AttemptRequests {
  inspect: { target?: string }
  prepare: PrepareRequest
  submit: { ticket: string; request: CanonicalRequest }
  lookup: { ticket: string }
  cancel: { ticket: string }
  result: { ticket: string }
  export: {
    ticket: string
    destination: string
    artifactResult?: string
    source?: 'final' | 'checkpoint'
  }
}
export interface AttemptResults {
  inspect: JsonValue
  prepare: Prepared
  lookup: AttemptObservation
  cancel: { acknowledged: boolean; observation: AttemptObservation }
  result: {
    observation: AttemptObservation
    output?: JsonValue
    artifactResults: ArtifactAvailability[]
    checkpoint?: AttemptCheckpoint
  }
  export: { destination: string; manifestDigest: string; source: 'final' | 'checkpoint' }
}
export type AttemptFrame =
  | {
      protocolVersion: 1
      operation: AttemptVerb
      event: 'error'
      code: AttemptErrorCode
      message: string
    }
  | {
      protocolVersion: 1
      operation: 'submit'
      event: 'accepted'
      role: 'owner' | 'observer'
      receipt: AttemptReceipt
    }
  | { protocolVersion: 1; operation: 'submit'; event: 'terminal'; observation: AttemptObservation }
  | {
      [V in keyof AttemptResults]: {
        protocolVersion: 1
        operation: V
        event: 'result'
        value: AttemptResults[V]
      }
    }[keyof AttemptResults]

/** Deliberately contains no offending value, source text, ticket, or native exception. */
export class AttemptContractError extends Error {
  constructor() {
    super('Invalid attempt machine record')
    this.name = 'AttemptContractError'
  }
}
function fail(): never {
  throw new AttemptContractError()
}
type Check = (value: unknown) => void
const string: Check = (v) => {
  if (typeof v !== 'string' || v.length === 0) fail()
}
const boolean: Check = (v) => {
  if (typeof v !== 'boolean') fail()
}
const integer: Check = (v) => {
  if (!Number.isSafeInteger(v) || (v as number) < 0) fail()
}
const positive: Check = (v) => {
  integer(v)
  if (v === 0) fail()
}
const json: Check = (v) => {
  try {
    validateJson1(v)
  } catch {
    fail()
  }
}
const digest: Check = (v) => {
  if (typeof v !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(v)) fail()
}
const timestamp: Check = (v) => {
  string(v)
  if (!Number.isFinite(Date.parse(v as string))) fail()
}
const ticket: Check = (v) => {
  string(v)
  if (new TextEncoder().encode(v as string).length > 2048) fail()
}
const choice =
  (values: readonly unknown[]): Check =>
  (v) => {
    if (!values.includes(v)) fail()
  }
const array =
  (check: Check): Check =>
  (v) => {
    if (!Array.isArray(v)) fail()
    for (const item of v) check(item)
  }
function record(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) fail()
    const obj = v as Record<string, unknown>
    for (const key of Object.keys(obj))
      if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) fail()
    for (const [key, check] of Object.entries(required)) {
      if (!Object.hasOwn(obj, key)) fail()
      check(obj[key])
    }
    for (const [key, check] of Object.entries(optional))
      if (Object.hasOwn(obj, key)) check(obj[key])
  }
}
const constraints = record({ durationMs: positive, resultBytes: positive, artifactBytes: integer })
const outputIntent = record({ packet: boolean, receive: array(string) })
const common = { expectedApproval: digest, target: string, input: json, constraints, outputIntent }
const canonical = record({
  ...common,
  files: array(record({ port: string, manifestDigest: digest, bytes: integer })),
})
const artifact = record(
  { name: string, availability: choice(['pending', 'available', 'expired', 'unavailable']) },
  { manifestDigest: digest },
)
const checkpoint = record(
  {
    availability: choice(['available', 'expired', 'unavailable']),
    artifactResults: array(artifact),
  },
  {
    sequence: positive,
    digest,
    evidence: json,
    files: (v) => {
      json(v)
      if (
        v === null ||
        typeof v !== 'object' ||
        Array.isArray(v) ||
        Object.values(v).some((value) => typeof value !== 'string')
      )
        fail()
    },
  },
)
const receipt = record({
  runId: string,
  requestDigest: digest,
  acceptedAt: timestamp,
  target: string,
  approval: digest,
  artifactResults: array(artifact),
})
const diagnostics: Check = (v) => {
  record({
    stderr: (v) => {
      if (typeof v !== 'string') fail()
    },
    stderrBytes: integer,
    stderrTruncated: boolean,
  })(v)
  const d = v as AttemptDiagnostics
  const size = new TextEncoder().encode(d.stderr).length
  let scalars = 0
  for (const _scalar of d.stderr) scalars++
  // TextDecoder replacement can expand one raw byte to three UTF-8 text bytes.
  // These are raw source counters, not the encoded size of decoded display text.
  if (
    size > ATTEMPT_DIAGNOSTIC_TEXT_BYTES ||
    d.stderrBytes < scalars ||
    (!d.stderrTruncated && d.stderrBytes > ATTEMPT_STDERR_BYTES)
  )
    fail()
}
const terminal: Check = (v) => {
  const status = (v as AttemptTerminal | null)?.status
  if (status === 'succeeded')
    record({ status: choice(['succeeded']), outcome: string, resultDigest: digest, diagnostics })(v)
  else if (status === 'failed')
    record(
      {
        status: choice(['failed']),
        code: choice(ATTEMPT_FAILURE_CODES),
        message: string,
        diagnostics,
      },
      { details: json },
    )(v)
  else record({ status: choice(['lost']), code: choice(['COORDINATOR_LOST']), message: string })(v)
}
const observationShape: Check = record(
  {
    identity: choice(['prepared', 'accepted', 'retired', 'unavailable']),
    dispatch: choice(['not-dispatched', 'possible', 'confirmed']),
  },
  {
    receipt,
    execution: choice(['accepted', 'running', 'terminal', 'uncertain']),
    terminal,
    cleanup: choice(['pending', 'confirmed', 'unresolved']),
    retained: choice(['available', 'expired', 'unavailable']),
    reason: choice(ATTEMPT_ERROR_CODES),
  },
)
const observation: Check = (value) => {
  observationShape(value)
  const o = value as AttemptObservation
  if (o.identity !== 'accepted') {
    if (o.receipt || o.execution || o.terminal || o.cleanup) fail()
    if (o.dispatch === 'confirmed' || o.retained === 'available') fail()
    if (o.identity === 'prepared' && o.dispatch !== 'not-dispatched') fail()
    if (o.identity === 'unavailable' && o.dispatch !== 'possible') fail()
    return
  }
  if (!o.receipt || !o.execution || !o.cleanup || !o.retained) fail()
  if ((o.execution === 'terminal') !== (o.terminal !== undefined)) fail()
  if (o.dispatch === 'not-dispatched' && !o.terminal) fail()
  if ((o.dispatch === 'confirmed') !== (o.terminal?.status === 'succeeded')) fail()
}
const requests: Record<AttemptVerb, Check> = {
  inspect: record({}, { target: string }),
  prepare: record({
    ...common,
    files: array(record({ port: string, source: string, selection: array(string) })),
  }),
  submit: record({ ticket, request: canonical }),
  lookup: record({ ticket }),
  cancel: record({ ticket }),
  result: record({ ticket }),
  export: (value) => {
    record(
      { ticket, destination: string },
      {
        artifactResult: string,
        source: choice(['final', 'checkpoint']),
      },
    )(value)
    const request = value as AttemptRequests['export']
    if (request.source === 'checkpoint' && request.artifactResult !== undefined) fail()
  },
}
const results: Record<keyof AttemptResults, Check> = {
  inspect: json,
  prepare: record({
    ticket,
    requestDigest: digest,
    submitBefore: timestamp,
    retainUntil: timestamp,
    canonicalRequest: canonical,
  }),
  lookup: observation,
  cancel: record({ acknowledged: boolean, observation }),
  result: (value) => {
    record({ observation, artifactResults: array(artifact) }, { output: json, checkpoint })(value)
    const result = value as AttemptResults['result']
    const terminal = result.observation.terminal
    const hasOutput = Object.hasOwn(result, 'output')
    const available =
      terminal?.status === 'succeeded' && result.observation.retained === 'available'
    if (hasOutput !== available) fail()
    if (
      hasOutput &&
      terminal?.status === 'succeeded' &&
      terminal.resultDigest !==
        `sha256:${createHash('sha256').update(canonicalJson(result.output!)).digest('hex')}`
    )
      fail()
  },
  export: record({
    destination: string,
    manifestDigest: digest,
    source: choice(['final', 'checkpoint']),
  }),
}
export function parseAttemptRequest<V extends AttemptVerb>(
  verb: V,
  value: unknown,
): AttemptRequests[V] {
  json(value)
  if (!Object.hasOwn(requests, verb)) fail()
  requests[verb](value)
  return value as AttemptRequests[V]
}
export function parseAttemptEnvelope<V extends AttemptVerb>(
  verb: V,
  value: unknown,
): { protocolVersion: 1; operation: V; request: AttemptRequests[V] } {
  record({
    protocolVersion: choice([1]),
    operation: choice([verb]),
    request: (v) => {
      parseAttemptRequest(verb, v)
    },
  })(value)
  return value as { protocolVersion: 1; operation: V; request: AttemptRequests[V] }
}
export function parseAttemptFrame(verb: AttemptVerb, value: unknown): AttemptFrame {
  json(value)
  const base = { protocolVersion: choice([1]), operation: choice([verb]) }
  const event = (value as AttemptFrame | null)?.event
  if (event === 'error')
    record({
      ...base,
      event: choice(['error']),
      code: choice(ATTEMPT_ERROR_CODES),
      message: string,
    })(value)
  else if (verb === 'submit' && event === 'accepted')
    record({ ...base, event: choice(['accepted']), role: choice(['owner', 'observer']), receipt })(
      value,
    )
  else if (verb === 'submit' && event === 'terminal') {
    record({ ...base, event: choice(['terminal']), observation })(value)
    if (
      (value as { observation: AttemptObservation }).observation.execution !== 'terminal' ||
      !(value as { observation: AttemptObservation }).observation.terminal ||
      (value as { observation: AttemptObservation }).observation.identity !== 'accepted' ||
      !(value as { observation: AttemptObservation }).observation.receipt
    )
      fail()
  } else if (verb !== 'submit')
    record({ ...base, event: choice(['result']), value: results[verb] })(value)
  else fail()
  return value as AttemptFrame
}
export function decodeAttemptLine(bytes: Uint8Array, limit = ATTEMPT_FRAME_BYTES): JsonValue {
  if (bytes.byteLength > limit) fail()
  try {
    return decodeJson1(bytes)
  } catch {
    return fail()
  }
}

export type JsonScalar = null | boolean | number | string

export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type JsonObject = Readonly<Record<string, JsonValue>>

export type AttachmentAccess = 'read' | 'read-write'

export interface Attachment {
  readonly path: string
  readonly access: AttachmentAccess
}

export type RunResult = {
  readonly outcome: string
  readonly output: JsonValue
}

export interface FlowCall {
  readonly operationId: string
  readonly slot: string
  readonly intent?: string
  readonly input: JsonValue
}

export interface EffectCall {
  readonly operationId: string
  readonly slot: string
  readonly method: string
  readonly input: JsonValue
}

export interface CallOptions {
  readonly signal?: AbortSignal
}

export interface RunContext {
  readonly input: JsonValue
  readonly settings: JsonObject
  readonly attachments: Readonly<Record<string, Attachment>>
  readonly scratch: string
  readonly deadlineUnixMs: number
  readonly signal: AbortSignal

  callFlow(call: FlowCall, options?: CallOptions): Promise<RunResult>
  callEffect(call: EffectCall, options?: CallOptions): Promise<JsonValue>
}

export type RunHandler = (context: RunContext) => Promise<RunResult>

export const OPERATION_ERROR_CODES = [
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
  'PROTOCOL_ERROR',
  'CHANNEL_LOST',
] as const

export type OperationErrorCode = (typeof OPERATION_ERROR_CODES)[number]

export class OperationError extends Error {
  readonly code: OperationErrorCode
  readonly details?: JsonValue

  constructor(code: OperationErrorCode, message: string = code, details?: JsonValue) {
    super(message)
    this.name = 'OperationError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export class EffectError extends Error {
  readonly errorName: string
  readonly data: JsonValue

  constructor(errorName: string, data: JsonValue) {
    super(`Effect failed with ${errorName}`)
    this.name = 'EffectError'
    this.errorName = errorName
    this.data = data
  }
}

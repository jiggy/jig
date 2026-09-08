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

export interface ChildFlowRequest {
  readonly operationId: string
  readonly slot: string
  readonly intent?: string
  readonly input: JsonValue
  readonly channels?: Readonly<Record<string, ChannelEndpoint>>
}

export interface CapabilityCall {
  readonly operationId: string
  readonly slot: string
  readonly method: string
  readonly input: JsonValue
  readonly channels?: Readonly<Record<string, ChannelEndpoint>>
}

export interface CallOptions {
  readonly signal?: AbortSignal
}

export interface ChannelContractIdentity {
  readonly id: string
  readonly version: string
  readonly digest: string
}

export interface ChannelOptions {
  readonly delivery?: 'direct'
  readonly schema?: JsonValue
  readonly contract?: string
}

export interface ChannelSender {
  readonly direction: 'send'
  readonly delivery: 'direct'
  readonly contract?: ChannelContractIdentity
  send(value: JsonValue, options?: CallOptions): Promise<void>
  close(options?: CallOptions): Promise<void>
}

export interface ChannelReceiver extends AsyncIterableIterator<JsonValue> {
  readonly direction: 'receive'
  readonly delivery: 'direct'
  readonly contract?: ChannelContractIdentity
  readonly startSequence: number
  next(options?: CallOptions): Promise<IteratorResult<JsonValue>>
  close(options?: CallOptions): Promise<void>
}

export type ChannelEndpoint = ChannelSender | ChannelReceiver

export interface ChannelPair {
  readonly send: ChannelSender
  readonly receive: ChannelReceiver
}

export interface RunContext {
  readonly input: JsonValue
  readonly settings: JsonObject
  readonly attachments: Readonly<Record<string, Attachment>>
  readonly channels: Readonly<Record<string, ChannelEndpoint>>
  readonly scratch: string
  readonly deadlineUnixMs: number
  readonly signal: AbortSignal

  runChildFlow(call: ChildFlowRequest, options?: CallOptions): Promise<RunResult>
  callCapability(call: CapabilityCall, options?: CallOptions): Promise<JsonValue>
  channel(options?: ChannelOptions, callOptions?: CallOptions): Promise<ChannelPair>
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
  'LAGGED',
  'DISCONNECTED',
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

export class CapabilityError extends Error {
  readonly errorName: string
  readonly data: JsonValue

  constructor(errorName: string, data: JsonValue) {
    super(`Capability failed with ${errorName}`)
    this.name = 'CapabilityError'
    this.errorName = errorName
    this.data = data
  }
}

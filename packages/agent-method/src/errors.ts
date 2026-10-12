import type { JsonObject } from './json.js'

export type AgentMethodErrorCode = 'INVALID_INPUT' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT'

export class AgentMethodError extends Error {
  constructor(
    readonly code: AgentMethodErrorCode,
    message: string,
    readonly details?: JsonObject,
  ) {
    super(message)
    this.name = 'AgentMethodError'
  }
}

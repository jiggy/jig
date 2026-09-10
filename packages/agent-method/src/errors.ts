export type AgentMethodErrorCode = 'INVALID_INPUT' | 'RESOURCE_EXHAUSTED' | 'INVALID_RESULT'

export class AgentMethodError extends Error {
  constructor(
    readonly code: AgentMethodErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AgentMethodError'
  }
}

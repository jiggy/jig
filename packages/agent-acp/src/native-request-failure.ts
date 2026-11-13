import { type JsonObject, OperationError } from '@jigging/flow'

export function preserveRequestDiagnostic(error: unknown, failure: unknown): unknown {
  if (
    !isPrePromptNativeRejection(error) ||
    !(failure instanceof OperationError) ||
    failure.code !== 'EXECUTION_FAILED'
  )
    return failure
  const details = failure.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return failure
  const prompt = (details as JsonObject).nativePrompt
  if (
    prompt === null ||
    typeof prompt !== 'object' ||
    Array.isArray(prompt) ||
    (prompt as JsonObject).forwarding !== 'not-forwarded' ||
    (prompt as JsonObject).cleanup !== 'confirmed'
  )
    return failure
  // Host code and evidence remain authoritative. The request diagnostic has
  // already been validated independently and grants no recovery authority.
  return new OperationError(failure.code, error.message, {
    nativeRequest: (error.details as JsonObject).nativeRequest!,
    ...(details as JsonObject),
  })
}

export function isPrePromptNativeRejection(error: unknown): error is OperationError {
  if (!(error instanceof OperationError) || error.code !== 'EXECUTION_FAILED') return false
  const details = error.details
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return false
  const request = (details as JsonObject).nativeRequest
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return false
  return ['initialize', 'session/new', 'session/resume', 'session/set_config_option'].includes(
    (request as JsonObject).method as string,
  )
}

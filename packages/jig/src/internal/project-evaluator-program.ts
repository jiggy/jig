import {
  PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES,
  PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES,
} from './project-evaluator-policy.js'

export interface PrivateAuthorEvaluatorSupport {
  readonly workerSource: string
  readonly sdkSource: string
}

const BOOTSTRAP = '__jigCapturedAuthorEvaluator'
const encoder = new TextEncoder()

/** Only verified installed support is executable. Authored request bytes remain
 * base64 data, parsed by the ordinary evaluator after native admission. */
export function privateAuthorEvaluatorProgram(
  request: Uint8Array,
  support: PrivateAuthorEvaluatorSupport,
): Uint8Array {
  if (request.byteLength > PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES)
    throw new RangeError('evaluator request exceeds its byte bound')
  if (
    Buffer.byteLength(support.workerSource) + Buffer.byteLength(support.sdkSource) >
    PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES
  )
    throw new RangeError('evaluator support exceeds its byte bound')
  const bootstrap = JSON.stringify({
    request: Buffer.from(request).toString('base64'),
    workerSource: support.workerSource,
    sdkSource: support.sdkSource,
  })
  // JSON.parse preserves JSON data semantics, including own __proto__ keys.
  // Never paste a request or SDK object into executable JavaScript syntax.
  const program = `globalThis.${BOOTSTRAP}=JSON.parse(${JSON.stringify(bootstrap)});\n${support.workerSource}\n`
  if (Buffer.byteLength(program) > PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES)
    throw new RangeError('evaluator program exceeds its byte bound')
  return encoder.encode(program)
}

/** Consumed once by the captured worker, before authored code or child launch. */
export function readPrivateAuthorEvaluatorProgram(): Readonly<{
  request: Uint8Array
  support: PrivateAuthorEvaluatorSupport
}> {
  const globals = globalThis as unknown as Record<string, unknown>
  const value = globals[BOOTSTRAP]
  delete globals[BOOTSTRAP]
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.keys(value).sort().join() !== 'request,sdkSource,workerSource'
  )
    throw new TypeError('invalid evaluator bootstrap')
  const bootstrap = value as Record<string, unknown>
  if (
    typeof bootstrap.request !== 'string' ||
    bootstrap.request.length > Math.ceil(PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES / 3) * 4 ||
    typeof bootstrap.workerSource !== 'string' ||
    typeof bootstrap.sdkSource !== 'string'
  )
    throw new TypeError('invalid evaluator bootstrap')
  const request = Buffer.from(bootstrap.request, 'base64')
  if (
    request.byteLength > PRIVATE_AUTHOR_EVALUATOR_MAX_REQUEST_BYTES ||
    request.toString('base64') !== bootstrap.request ||
    Buffer.byteLength(bootstrap.workerSource) + Buffer.byteLength(bootstrap.sdkSource) >
      PRIVATE_AUTHOR_EVALUATOR_MAX_PROGRAM_BYTES
  )
    throw new TypeError('invalid evaluator bootstrap')
  return Object.freeze({
    request,
    support: Object.freeze({
      workerSource: bootstrap.workerSource,
      sdkSource: bootstrap.sdkSource,
    }),
  })
}

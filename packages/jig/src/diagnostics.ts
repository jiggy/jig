export type DiagnosticKind = 'invalid' | 'unavailable'

export class CheckError extends Error {
  readonly kind: DiagnosticKind
  readonly code: string
  readonly path?: string
  readonly pointer?: string
  readonly typeMismatch?: import('./schema/types.js').SchemaTypeMismatch
  readonly lockPath?: string

  constructor(
    kind: DiagnosticKind,
    code: string,
    message: string,
    path?: string,
    pointer?: string,
    typeMismatch?: import('./schema/types.js').SchemaTypeMismatch,
    lockPath?: string,
  ) {
    super(message)
    this.name = 'CheckError'
    this.kind = kind
    this.code = code
    if (path !== undefined) this.path = path
    if (pointer !== undefined) this.pointer = pointer
    if (typeMismatch !== undefined) this.typeMismatch = typeMismatch
    if (lockPath !== undefined) this.lockPath = lockPath
  }
}

export function invalid(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError('invalid', code, message, path, pointer)
}

export function unavailable(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError('unavailable', code, message, path, pointer)
}

export type DiagnosticKind = 'invalid' | 'unavailable'

/** Bounded resource facts, without worker messages or private filesystem names. */
export interface DependencyPreparationLimitDiagnostic {
  readonly dimension: 'files' | 'bytes'
  readonly observed: number
  readonly maximum: number
  readonly origin?: 'default' | 'project' | 'environment'
  readonly profile?: 'evaluation'
}

export class CheckError extends Error {
  readonly kind: DiagnosticKind
  readonly code: string
  readonly path?: string
  readonly pointer?: string
  readonly typeMismatch?: import('./schema/types.js').SchemaTypeMismatch
  readonly lockPath?: string
  readonly preparationLimit?: DependencyPreparationLimitDiagnostic

  constructor(
    kind: DiagnosticKind,
    code: string,
    message: string,
    path?: string,
    pointer?: string,
    typeMismatch?: import('./schema/types.js').SchemaTypeMismatch,
    lockPath?: string,
    preparationLimit?: DependencyPreparationLimitDiagnostic,
  ) {
    super(message)
    this.name = 'CheckError'
    this.kind = kind
    this.code = code
    if (path !== undefined) this.path = path
    if (pointer !== undefined) this.pointer = pointer
    if (typeMismatch !== undefined) this.typeMismatch = typeMismatch
    if (lockPath !== undefined) this.lockPath = lockPath
    if (preparationLimit !== undefined) this.preparationLimit = preparationLimit
  }
}

export function invalid(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError('invalid', code, message, path, pointer)
}

export function unavailable(code: string, message: string, path?: string, pointer?: string): never {
  throw new CheckError('unavailable', code, message, path, pointer)
}

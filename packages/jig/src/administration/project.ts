import { types as utilTypes } from 'node:util'

import { validateJson1 } from '../json.js'
import { isProtectedProjectPath, validateProjectPath } from '../project/paths.js'
import { type SchemaTypeMismatch, schemaTypeMismatchText } from '../schema/types.js'
import type { RootAdministration } from './root.js'

const DIGEST = /^sha256:[0-9a-f]{64}$/
const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,127}$/
const MAX_MESSAGE_SCALARS = 1_024
const MAX_POINTER_SCALARS = 1_024

export type ProjectAdministrationErrorCode =
  | 'AUTHORITY_APPROVAL_REQUIRED'
  | 'INVALID_REQUEST'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_UNSAFE'
  | 'PROJECT_STATE_INVALID'
  | 'INVALID_CANDIDATE'
  | 'LOCK_MISMATCH'
  | 'PLAN_NOT_FOUND'
  | 'STALE_PLAN'
  | 'PROJECT_BUSY'
  | 'PROJECT_CLOSED'
  | 'UNAVAILABLE'
  | 'INTERNAL'

export interface ProjectAdministrationErrorValue {
  readonly code: ProjectAdministrationErrorCode
  readonly message: string
  readonly diagnostic?: ProjectAdministrationDiagnostic
}

export interface ProjectAdministrationDiagnostic {
  readonly code: string
  readonly path: string
  readonly pointer?: string
  readonly typeMismatch?: SchemaTypeMismatch
}

export interface ProjectPlanRequest {
  readonly lockMode: 'update' | 'locked'
}

export type ProjectPlanResult =
  | { readonly state: 'unchanged' }
  | {
      readonly state: 'applicable'
      readonly operation: 'admission' | 'lock-repair'
      readonly planDigest: string
      readonly review: {
        readonly mediaType: 'text/plain; charset=utf-8'
        readonly text: string
        readonly details: string
        readonly authorityChanges: boolean
      }
    }

export interface ProjectApplyRequest {
  readonly planDigest: string
  readonly allowAuthorityChanges?: boolean
}

export interface ProjectApplyReceipt {
  readonly operation: 'admission' | 'lock-repair'
  readonly planDigest: string
}

export interface ProjectSession {
  plan(request: ProjectPlanRequest): Promise<ProjectPlanResult>
  apply(request: ProjectApplyRequest): Promise<ProjectApplyReceipt>
  readonly rootAdministration: RootAdministration
  close(): Promise<void>
}

export class ProjectAdministrationError extends Error {
  readonly code: ProjectAdministrationErrorCode
  readonly diagnostic?: ProjectAdministrationDiagnostic

  constructor(
    code: ProjectAdministrationErrorCode,
    message: string,
    diagnostic?: ProjectAdministrationDiagnostic,
  ) {
    requireErrorCode(code)
    const messageScalars = typeof message === 'string' ? scalarLength(message) : 0
    try {
      validateJson1(message)
    } catch {
      throw new TypeError('project administration error message is invalid')
    }
    if (messageScalars < 1 || messageScalars > MAX_MESSAGE_SCALARS) {
      throw new TypeError('project administration error message is invalid')
    }
    super(message)
    this.name = 'ProjectAdministrationError'
    this.code = code
    if (diagnostic !== undefined) {
      if (code !== 'INVALID_CANDIDATE' && code !== 'UNAVAILABLE') {
        throw new TypeError('project diagnostic requires INVALID_CANDIDATE or UNAVAILABLE')
      }
      this.diagnostic = normalizeProjectAdministrationDiagnostic(diagnostic)
    }
  }

  toJSON(): ProjectAdministrationErrorValue {
    return Object.freeze({
      code: this.code,
      message: this.message,
      ...(this.diagnostic === undefined ? {} : { diagnostic: this.diagnostic }),
    })
  }
}

/** Package-private request normalization for the trusted project controller. */
export function normalizeProjectPlanRequest(value: unknown): ProjectPlanRequest {
  const input = exactRecord(value, ['lockMode'], 'plan request')
  if (input.lockMode !== 'update' && input.lockMode !== 'locked') {
    invalidRequest('plan lockMode must be update or locked')
  }
  return Object.freeze({ lockMode: input.lockMode })
}

/** Package-private request normalization for the trusted project controller. */
export function normalizeProjectApplyRequest(value: unknown): ProjectApplyRequest {
  const input = exactRecord(
    value,
    [
      'planDigest',
      ...(value !== null &&
      typeof value === 'object' &&
      Object.hasOwn(value, 'allowAuthorityChanges')
        ? ['allowAuthorityChanges']
        : []),
    ],
    'apply request',
  )
  if (typeof input.planDigest !== 'string' || !DIGEST.test(input.planDigest)) {
    invalidRequest('apply planDigest is invalid')
  }
  if (input.allowAuthorityChanges !== undefined && typeof input.allowAuthorityChanges !== 'boolean')
    invalidRequest('allowAuthorityChanges must be boolean')
  return Object.freeze({
    planDigest: input.planDigest,
    ...(input.allowAuthorityChanges === undefined
      ? {}
      : { allowAuthorityChanges: input.allowAuthorityChanges as boolean }),
  })
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    invalidRequest(`${label} must be a plain object`)
  }
  const actual = Reflect.ownKeys(value)
  if (
    actual.some((key) => typeof key !== 'string') ||
    actual.length !== keys.length ||
    keys.some((key) => !actual.includes(key))
  ) {
    invalidRequest(`${label} must contain exactly ${keys.join(', ')}`)
  }
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      invalidRequest(`${label} must contain data fields only`)
    }
    output[key] = descriptor.value
  }
  return output
}

function requireErrorCode(value: unknown): asserts value is ProjectAdministrationErrorCode {
  if (
    value !== 'AUTHORITY_APPROVAL_REQUIRED' &&
    value !== 'INVALID_REQUEST' &&
    value !== 'PROJECT_NOT_FOUND' &&
    value !== 'PROJECT_UNSAFE' &&
    value !== 'PROJECT_STATE_INVALID' &&
    value !== 'INVALID_CANDIDATE' &&
    value !== 'LOCK_MISMATCH' &&
    value !== 'PLAN_NOT_FOUND' &&
    value !== 'STALE_PLAN' &&
    value !== 'PROJECT_BUSY' &&
    value !== 'PROJECT_CLOSED' &&
    value !== 'UNAVAILABLE' &&
    value !== 'INTERNAL'
  ) {
    throw new TypeError('project administration error code is invalid')
  }
}

function invalidRequest(message: string): never {
  throw new ProjectAdministrationError('INVALID_REQUEST', message)
}

function scalarLength(value: string): number {
  return [...value].length
}

function normalizeProjectAdministrationDiagnostic(
  value: ProjectAdministrationDiagnostic,
): ProjectAdministrationDiagnostic {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError('project diagnostic is invalid')
  }
  const actual = Reflect.ownKeys(value)
  const allowed = ['code', 'path', 'pointer', 'typeMismatch']
  if (
    actual.some((key) => typeof key !== 'string' || !allowed.includes(key)) ||
    !actual.includes('code') ||
    !actual.includes('path')
  ) {
    throw new TypeError('project diagnostic is invalid')
  }
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of actual as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      throw new TypeError('project diagnostic is invalid')
    }
    fields[key] = descriptor.value
  }

  const code = fields.code
  if (typeof code !== 'string' || !DIAGNOSTIC_CODE.test(code)) {
    throw new TypeError('project diagnostic code is invalid')
  }

  const path = fields.path
  try {
    // A workspace may be above the project. Only these closed manifest
    // diagnostics may name an ancestor; this is display data, not a file route.
    const manifestCause =
      /^PACKAGE_BUN_MANIFEST_(SHAPE|FIELD|DEPENDENCIES|NAME|SOURCE|PATCH)$/.test(code)
    const ancestor =
      manifestCause && typeof path === 'string' ? /^(?:\.\.\/)+/.exec(path)?.[0] : undefined
    const local = ancestor === undefined ? path : (path as string).slice(ancestor.length)
    validateProjectPath(local, 'project diagnostic path')
    if (
      ancestor !== undefined &&
      (ancestor.length / 3 > 32 ||
        Buffer.byteLength(path as string) > 1024 ||
        (path as string).split('/').length > 64 ||
        !(path as string).endsWith('/package.json'))
    )
      throw new TypeError('invalid workspace diagnostic path')
    if (local.split('/').some(isProtectedProjectPath))
      throw new TypeError('protected diagnostic path')
  } catch {
    throw new TypeError('project diagnostic path is invalid')
  }
  // The validator above has also checked the ancestor-relative display form.
  if (typeof path !== 'string') throw new TypeError('project diagnostic path is invalid')

  let pointer: string | undefined
  if (actual.includes('pointer')) {
    if (typeof fields.pointer !== 'string') {
      throw new TypeError('project diagnostic pointer is invalid')
    }
    try {
      validateJson1(fields.pointer)
    } catch {
      throw new TypeError('project diagnostic pointer is invalid')
    }
    if (
      scalarLength(fields.pointer) > MAX_POINTER_SCALARS ||
      (fields.pointer !== '' &&
        (!fields.pointer.startsWith('/') || /~(?:[^01]|$)/.test(fields.pointer)))
    ) {
      throw new TypeError('project diagnostic pointer is invalid')
    }
    pointer = fields.pointer
  }

  let typeMismatch: SchemaTypeMismatch | undefined
  if (actual.includes('typeMismatch')) {
    validateJson1(fields.typeMismatch)
    const detail = exactRecord(fields.typeMismatch, ['expected', 'received'], 'type mismatch')
    if (schemaTypeMismatchText(detail) === undefined) {
      throw new TypeError('project diagnostic type mismatch is invalid')
    }
    typeMismatch = Object.freeze({
      expected: Object.freeze([...(detail.expected as string[])]),
      received: detail.received as string,
    })
  }
  return Object.freeze({
    code,
    path,
    ...(pointer === undefined ? {} : { pointer }),
    ...(typeMismatch === undefined ? {} : { typeMismatch }),
  })
}

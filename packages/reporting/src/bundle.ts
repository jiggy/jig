import { canonicalReportingMessage, validateReportingMessage } from './validation.js'
import {
  dataRecord,
  identityText,
  type Reference,
  scalarText,
  type ViewItem,
  type ViewTarget,
  validateReference,
  validateViewTarget,
} from './view.js'

export type DisplayPublicationView = Readonly<{
  view: ViewItem & Readonly<{ target: ViewTarget }>
  expectedRevision: string | null
  completeness: 'complete' | 'partial'
  domainRevision?: string
}>
export type DisplayBundle = Readonly<{
  kind: 'display-bundle'
  requestId: string
  generation: string
  edition: string
  views: readonly DisplayPublicationView[]
  requiredEvidence?: readonly Reference[]
}>
export type DisplayPublicationContext = Readonly<{
  generation: string
  heads: readonly Readonly<{
    definitionId: string
    instanceKey: string
    revision: string
    retained: boolean
  }>[]
}>
export type DisplayBundleOptions = Readonly<{
  requestId: string
  edition: string
  views: readonly Readonly<{
    view: ViewItem & Readonly<{ target: ViewTarget }>
    completeness: 'complete' | 'partial'
    domainRevision?: string
  }>[]
  requiredEvidence?: readonly Reference[]
}>
export const DISPLAY_BUNDLE_LIMITS = Object.freeze({
  bytes: 4 * 1024 * 1024,
  views: 32,
  requiredEvidence: 256,
})

function items(value: unknown, maximum: number, label: string, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum)
    throw new TypeError(`${label} exceeds its item limit`)
  if (Reflect.ownKeys(value).length !== value.length + 1)
    throw new TypeError(`${label} must contain only dense data items`)
  return Array.from({ length: value.length }, (_, index) => {
    const property = Object.getOwnPropertyDescriptor(value, String(index))
    if (!property || !('value' in property))
      throw new TypeError(`${label}[${index}] must be a data item`)
    return property.value
  })
}

/** Bind application projections to opaque archive heads, including removal fences. */
export function createDisplayBundle(
  inputContext: DisplayPublicationContext,
  inputOptions: DisplayBundleOptions,
): DisplayBundle {
  const context = dataRecord(inputContext, ['generation', 'heads'])
  const options = dataRecord(inputOptions, ['requestId', 'edition', 'views', 'requiredEvidence'])
  const heads = new Map<string, string>()
  for (const input of items(context.heads, 4096, 'heads')) {
    const head = dataRecord(input, ['definitionId', 'instanceKey', 'revision', 'retained'])
    const target = validateViewTarget({
      definitionId: head.definitionId,
      instanceKey: head.instanceKey,
    })
    if (typeof head.retained !== 'boolean') throw new TypeError('heads.retained must be boolean')
    const key = JSON.stringify([target.definitionId, target.instanceKey])
    if (heads.has(key)) throw new TypeError('Publication context contains duplicate target heads')
    heads.set(key, identityText(head.revision, 128))
  }
  return validateDisplayBundle({
    kind: 'display-bundle',
    requestId: options.requestId,
    generation: identityText(context.generation, 128),
    edition: options.edition,
    views: items(options.views, DISPLAY_BUNDLE_LIMITS.views, 'views', 1).map((input) => {
      const entry = dataRecord(input, ['view', 'completeness', 'domainRevision'])
      const view = validateReportingMessage(entry.view)
      if (view.kind !== 'view') throw new TypeError('Publication material must be a semantic view')
      const target = validateViewTarget(view.target)
      return {
        ...entry,
        expectedRevision:
          heads.get(JSON.stringify([target.definitionId, target.instanceKey])) ?? null,
      }
    }),
    ...(Object.hasOwn(options, 'requiredEvidence')
      ? { requiredEvidence: options.requiredEvidence }
      : {}),
  })
}

/** Own a finite edition without granting producer identity or file authority. */
export function validateDisplayBundle(input: unknown): DisplayBundle {
  const bundle = dataRecord(input, [
    'kind',
    'requestId',
    'generation',
    'edition',
    'views',
    'requiredEvidence',
  ])
  if (bundle.kind !== 'display-bundle') throw new TypeError('Unknown display bundle kind')
  const ids = new Set<string>(),
    targets = new Set<string>()
  let landing = false
  const views = items(bundle.views, DISPLAY_BUNDLE_LIMITS.views, 'views', 1).map((input, index) => {
    const entry = dataRecord(input, ['view', 'expectedRevision', 'completeness', 'domainRevision'])
    const view = validateReportingMessage(entry.view)
    if (view.kind !== 'view') throw new TypeError(`views[${index}].view must be a semantic view`)
    const target = validateViewTarget(view.target)
    if (ids.has(view.id)) throw new TypeError(`views[${index}].view.id is duplicated`)
    ids.add(view.id)
    const key = JSON.stringify([target.definitionId, target.instanceKey])
    if (targets.has(key)) throw new TypeError(`views[${index}].view.target is duplicated`)
    targets.add(key)
    if (view.landing) {
      if (landing) throw new TypeError('Only one bundle view may nominate a landing hint')
      landing = true
    }
    if (!Object.hasOwn(entry, 'expectedRevision'))
      throw new TypeError(`views[${index}].expectedRevision is required`)
    if (entry.completeness !== 'complete' && entry.completeness !== 'partial')
      throw new TypeError(`views[${index}].completeness must be complete or partial`)
    return Object.freeze({
      view: Object.freeze({ ...view, target }),
      expectedRevision:
        entry.expectedRevision === null ? null : identityText(entry.expectedRevision, 128),
      completeness: entry.completeness,
      ...(Object.hasOwn(entry, 'domainRevision')
        ? { domainRevision: scalarText(entry.domainRevision, 128, true) }
        : {}),
    })
  })
  const result: DisplayBundle = Object.freeze({
    kind: 'display-bundle',
    requestId: identityText(bundle.requestId, 128),
    generation: identityText(bundle.generation, 128),
    edition: scalarText(bundle.edition, 128, true),
    views: Object.freeze(views),
    ...(Object.hasOwn(bundle, 'requiredEvidence')
      ? {
          requiredEvidence: Object.freeze(
            items(
              bundle.requiredEvidence,
              DISPLAY_BUNDLE_LIMITS.requiredEvidence,
              'requiredEvidence',
            ).map(validateReference),
          ),
        }
      : {}),
  })
  if (
    new TextEncoder().encode(canonicalReportingMessage(result)).byteLength >
    DISPLAY_BUNDLE_LIMITS.bytes
  )
    throw new TypeError('Encoded display bundle exceeds its byte limit')
  return result
}

export function encodeDisplayBundle(input: DisplayBundle): string {
  return `${canonicalReportingMessage(validateDisplayBundle(input))}\n`
}
export function decodeDisplayBundle(input: Uint8Array): DisplayBundle {
  if (!(input instanceof Uint8Array) || input.byteLength > DISPLAY_BUNDLE_LIMITS.bytes + 1)
    throw new TypeError('Captured display bundle exceeds its byte limit')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input))
  } catch {
    throw new TypeError('Captured display bundle is not a UTF-8 JSON document')
  }
  return validateDisplayBundle(value)
}

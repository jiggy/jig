/** Framing is data transport, not permission to dispatch an ACP operation. */
export const FINITE_ACP_LIMITS = Object.freeze({
  fragmentBytes: 8_192,
  frameBytes: 16_777_216,
  requestBytes: 8_388_608,
  responseBytes: 33_554_432,
  requestFrames: 32,
  responseFrames: 8_192,
  fragments: 16_384,
  identifierBytes: 1_024,
})

export type FiniteAcpConfiguration =
  | { readonly configId: string; readonly value: string }
  | { readonly configId: string; readonly type: 'boolean'; readonly value: boolean }

export interface FiniteAcpReady {
  readonly kind: 'ready'
  readonly protocolVersion: 1
  readonly cwd: '/work'
  readonly configuration: readonly FiniteAcpConfiguration[]
  readonly modeId?: string
}

export interface FiniteAcpFragment {
  readonly kind: 'data'
  readonly text: string
  readonly end: boolean
}

export class FiniteAcpTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FiniteAcpTransportError'
  }
}

const encoder = new TextEncoder()

/** Does not invoke getters or accept non-data objects at a library boundary. */
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    invalid('Expected an object')
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) invalid('Expected a data object')
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid('Unexpected object key')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      invalid('Expected data properties')
    result[key] = descriptor.value
  }
  return result
}

function exact(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid('Unexpected object fields')
}

/** Count scalar UTF-8 bytes without replacing invalid Unicode or allocating it. */
function textBytes(value: unknown, maximum: number, empty = false): number {
  if (typeof value !== 'string' || (!empty && value.length === 0)) invalid('Expected nonempty text')
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index)
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid('Text is not Unicode scalar data')
      bytes += 4
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid('Text is not Unicode scalar data')
    else bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3
    if (bytes > maximum) invalid('Text exceeds the finite ACP byte limit')
  }
  return bytes
}

function identifier(value: unknown): string {
  textBytes(value, FINITE_ACP_LIMITS.identifierBytes)
  if ((value as string).includes('\0')) invalid('Identifier contains NUL')
  return value as string
}

/** Snapshot the host's non-secret ready record; this copy grants no authority. */
export function readFiniteAcpReady(value: unknown): FiniteAcpReady {
  const record = object(value)
  exact(record, ['kind', 'protocolVersion', 'cwd', 'configuration'], ['modeId'])
  if (
    record.kind !== 'ready' ||
    record.protocolVersion !== 1 ||
    record.cwd !== '/work' ||
    !Array.isArray(record.configuration) ||
    record.configuration.length > 16
  )
    invalid('Invalid finite ACP ready record')
  const names = new Set<string>()
  const input = record.configuration
  if (
    Object.getPrototypeOf(input) !== Array.prototype ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    invalid('Configuration must be a dense data array')
  const configuration = Array.from({ length: input.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable)
      invalid('Configuration must be a dense data array')
    const item = descriptor.value
    const entry = object(item)
    exact(entry, ['configId', 'value'], ['type'])
    const configId = identifier(entry.configId)
    if (names.has(configId)) invalid('Duplicate finite ACP configuration')
    names.add(configId)
    if (entry.type === 'boolean') {
      if (typeof entry.value !== 'boolean') invalid('Invalid Boolean configuration')
      return Object.freeze({ configId, type: 'boolean' as const, value: entry.value })
    }
    if (Object.hasOwn(entry, 'type')) invalid('Unsupported finite ACP configuration')
    return Object.freeze({ configId, value: identifier(entry.value) })
  })
  const ready: FiniteAcpReady = Object.freeze({
    kind: 'ready',
    protocolVersion: 1,
    cwd: '/work',
    configuration: Object.freeze(configuration),
    ...(Object.hasOwn(record, 'modeId') ? { modeId: identifier(record.modeId) } : {}),
  })
  if (encoder.encode(JSON.stringify(ready)).byteLength > 65_536)
    invalid('Ready record exceeds the channel item bound')
  return ready
}

/** One complete JSON frame, split only between Unicode scalars. No replay IDs. */
export function* fragmentFiniteAcpFrame(text: string): Generator<FiniteAcpFragment> {
  textBytes(text, FINITE_ACP_LIMITS.frameBytes)
  let start = 0
  let bytes = 0
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index)!
    const width = code > 0xffff ? 2 : 1
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (bytes + size > FINITE_ACP_LIMITS.fragmentBytes) {
      yield Object.freeze({ kind: 'data', text: text.slice(start, index), end: false })
      start = index
      bytes = 0
    }
    bytes += size
    index += width
  }
  yield Object.freeze({ kind: 'data', text: text.slice(start), end: true })
}

/** Bounded single-frame assembly. Failure permanently invalidates this stream. */
export class FiniteAcpFrames {
  private readonly maximumBytes: number
  private readonly maximumFrames: number
  private totalBytes = 0
  private frameBytes = 0
  private frames = 0
  private fragments = 0
  private parts: string[] = []
  private ended = false
  private failed = false

  constructor(direction: 'requests' | 'responses') {
    if (direction !== 'requests' && direction !== 'responses')
      invalid('Unknown finite ACP direction')
    this.maximumBytes =
      direction === 'requests' ? FINITE_ACP_LIMITS.requestBytes : FINITE_ACP_LIMITS.responseBytes
    this.maximumFrames =
      direction === 'requests' ? FINITE_ACP_LIMITS.requestFrames : FINITE_ACP_LIMITS.responseFrames
  }

  accept(value: unknown): string | undefined {
    return this.guard(() => {
      const record = object(value)
      exact(record, ['kind', 'text', 'end'])
      if (record.kind !== 'data' || typeof record.end !== 'boolean')
        invalid('Invalid finite ACP fragment')
      const bytes = textBytes(record.text, FINITE_ACP_LIMITS.fragmentBytes)
      this.frameBytes += bytes
      this.totalBytes += bytes
      this.fragments++
      if (
        this.frameBytes > FINITE_ACP_LIMITS.frameBytes ||
        this.totalBytes > this.maximumBytes ||
        this.fragments > FINITE_ACP_LIMITS.fragments
      )
        invalid('Finite ACP stream exceeds its bounds')
      this.parts.push(record.text as string)
      if (!record.end) return undefined
      if (++this.frames > this.maximumFrames) invalid('Finite ACP stream has too many frames')
      const frame = this.parts.join('')
      this.parts = []
      this.frameBytes = 0
      return frame
    })
  }

  finish(): void {
    this.guard(() => {
      if (this.parts.length !== 0) invalid('Finite ACP stream ended inside a frame')
      this.ended = true
    })
  }

  private guard<T>(action: () => T): T {
    if (this.failed || this.ended) invalid('Finite ACP stream is not open')
    try {
      return action()
    } catch (error) {
      this.failed = true
      this.parts = []
      throw error
    }
  }
}

function invalid(message: string): never {
  throw new FiniteAcpTransportError(message)
}

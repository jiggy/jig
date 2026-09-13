import { privateCliHumanText } from './cli-presentation.js'
import type { JsonValue } from './json.js'

/** Untrusted text stays text, never terminal instructions or trusted headings. */
function safeText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
    character === '\n'
      ? character
      : character
          .split('')
          .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)
          .join(''),
  )
}

function quoted(text: string): string {
  return safeText(JSON.stringify(text))
}

/** Preserve arbitrary application schemas, including nulls, arrays and text paragraphs. */
export function privateCliValueFields(value: JsonValue, depth = 1): string {
  const indent = '  '.repeat(depth)
  if (typeof value === 'string')
    return (
      value
        .split('\n')
        .map((line) => `${indent}${safeText(line)}`)
        .join('\n') + '\n'
    )
  if (value === null || typeof value !== 'object' || Object.keys(value).length === 0)
    return `${indent}${JSON.stringify(value)}\n`
  return Object.entries(value)
    .map(([key, item]) => {
      const label = `${indent}${quoted(key)}`
      if (typeof item === 'string')
        return item.includes('\n') || item.length > 60
          ? `${label} (text):\n${fields(item, depth + 1)}`
          : `${label}: ${quoted(item)}\n`
      if (item !== null && typeof item === 'object' && Object.keys(item).length > 0)
        return `${label} (${Array.isArray(item) ? 'list' : 'object'}):\n${fields(item, depth + 1)}`
      return `${label}: ${JSON.stringify(item)}\n`
    })
    .join('')
}

const fields = privateCliValueFields

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Only interactive stdout uses this view; machine records bypass it completely. */
export class PrivateCliRunPresentation {
  #channel: string | undefined
  #openLine = false
  constructor(
    readonly write: (text: string) => Promise<void>,
    readonly color: boolean,
    readonly columns: number,
  ) {}

  async #section(title: string): Promise<void> {
    await this.finish()
    await this.write(privateCliHumanText(`Run output: ${title}\n`, this.color, this.columns))
  }

  async finish(): Promise<void> {
    if (this.#openLine) await this.write('\n')
    this.#openLine = false
  }

  async channel(value: JsonValue): Promise<void> {
    if (!isObject(value)) return
    const name = typeof value.channel === 'string' ? value.channel : ''
    if (this.#channel !== name) {
      await this.#section(`channel ${quoted(name)}`)
      this.#channel = name
    }
    if (value.type === 'data') {
      if (typeof value.value === 'string') {
        if (value.value.length === 0) return
        // Do not run arbitrary fragments through heading recognition or word wrapping.
        await this.write(safeText(value.value))
        this.#openLine = !value.value.endsWith('\n')
      } else {
        await this.finish()
        await this.write(
          privateCliHumanText(fields({ value: value.value ?? null }), this.color, this.columns),
        )
      }
    } else if (value.type === 'end') {
      await this.finish()
      await this.write(
        privateCliHumanText(
          `\nChannel ${quoted(name)}: ${value.status === 'closed' ? 'closed' : `failed (${quoted(String(value.code ?? 'unknown'))})`}\n`,
          this.color,
          this.columns,
        ),
      )
      this.#channel = undefined
    }
  }

  async result(record: JsonValue, streamedDiagnostics: string): Promise<void> {
    let view = record
    let note = ''
    // These are host envelope facts only. Application text and field names
    // cannot establish execution, acceptance, delivery or cleanup success.
    if (isObject(record)) {
      const summary: string[] = []
      if (record.status === 'succeeded') {
        summary.push('  Execution: completed.')
        if (typeof record.outcome === 'string')
          summary.push(`  Application outcome: ${quoted(record.outcome)}.`)
      } else if (record.status === 'failed') summary.push('  Execution: failed.')
      else if (record.status === 'lost')
        summary.push('  Execution: lost; effects may be uncertain.')
      if (isObject(record.delivery)) {
        summary.push(`  Packet delivery: ${quoted(String(record.delivery.status))}.`)
        if (typeof record.delivery.destination === 'string')
          summary.push(`  Destination: ${quoted(record.delivery.destination)}`)
      }
      if (isObject(record.cleanup) && record.cleanup.status === 'failed')
        summary.push('  Cleanup: not confirmed. Do not start replacement work yet.')
      if (isObject(record.checkpoint))
        summary.push('  Checkpoint: retained progress, not proof of success. See details below.')
      if (
        summary.length > 0 &&
        (record.status === 'succeeded' || Object.hasOwn(record, 'output') || summary.length > 1)
      ) {
        await this.#section('summary')
        await this.write(privateCliHumanText(`${summary.join('\n')}\n`, this.color, this.columns))
      }
      const { status: _status, outcome: _outcome, ...rest } = record
      // Failed/lost records are handled below with their original discriminants.
      if (record.status === 'succeeded') view = rest
    }
    if (isObject(record)) {
      const diagnostics = record.diagnostics
      if (isObject(diagnostics) && diagnostics.stderr === streamedDiagnostics) {
        const { diagnostics: _diagnostics, ...rest } = view as Record<string, JsonValue>
        view = rest
        if (diagnostics.stderrBytes !== 0)
          note = `\n  Diagnostics: ${diagnostics.stderrBytes} bytes shown live${diagnostics.stderrTruncated ? '; retained capture truncated' : ''}.\n`
      }
    }
    // The command's failure block owns status, code and the safe explanation.
    if (isObject(view) && (view.status === 'failed' || view.status === 'lost')) {
      const review = view.details
      if (
        view.code === 'REVIEW_REQUIRED' &&
        isObject(review) &&
        review.reason === 'EXECUTION_ENVIRONMENT_CHANGED' &&
        review.flowStarted === false &&
        Object.keys(review).length === 2
      ) {
        const { details: _review, ...rest } = view
        view = rest
      }
      const { status: _status, code: _code, message: _message, ...details } = view
      view = details
      if (Object.keys(details).length === 0 && note === '') return
    }
    await this.#section('result')
    await this.write(
      privateCliHumanText(
        (isObject(view) && Object.keys(view).length === 0 ? '' : fields(view)) + note,
        this.color,
        this.columns,
      ),
    )
  }
}

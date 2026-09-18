import { privateCliHumanText } from './cli-presentation.js'
import { privateCliValueFields as fields } from './cli-value-presentation.js'
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

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Only interactive stdout uses this view; machine records bypass it completely. */
export class PrivateCliRunPresentation {
  #channel: string | undefined
  #openLine = false
  #shownDiagnostics = new Map<string, string>()
  #diagnosticBytes = 64 * 1024
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

  /** Call only after the diagnostic sink accepted this text. Attribution is host-owned. */
  diagnostic(text: string, operations: readonly string[] = []): void {
    const key = JSON.stringify(operations)
    if (!this.#shownDiagnostics.has(key) && this.#shownDiagnostics.size === 32) return
    const bytes = new TextEncoder().encode(text)
    // Streaming decode excludes an incomplete UTF-8 suffix at the capture boundary.
    const kept = new TextDecoder().decode(bytes.slice(0, this.#diagnosticBytes), { stream: true })
    this.#diagnosticBytes -= Math.min(bytes.length, this.#diagnosticBytes)
    this.#shownDiagnostics.set(key, (this.#shownDiagnostics.get(key) ?? '') + kept)
  }

  async result(record: JsonValue): Promise<void> {
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
      const details = { ...(view as Record<string, JsonValue>) }
      const remaining = (
        value: JsonValue,
        operations: readonly string[],
      ): JsonValue | undefined => {
        if (!isObject(value) || typeof value.stderr !== 'string') return value
        const shown = this.#shownDiagnostics.get(JSON.stringify(operations)) ?? ''
        let offset = 0
        for (const character of value.stderr) {
          if (!shown.startsWith(character, offset)) break
          offset += character.length
        }
        const source = operations.length === 0 ? 'root' : quoted(operations.join(' / '))
        if (offset > 0)
          note += `\n  Diagnostics (${source}): ${new TextEncoder().encode(value.stderr.slice(0, offset)).length} bytes of text shown live.\n`
        if (value.stderrTruncated)
          note += `\n  Diagnostics (${source}): retained capture truncated.\n`
        return offset === value.stderr.length
          ? undefined
          : { ...value, stderr: value.stderr.slice(offset) }
      }
      const aggregate = record.runDiagnostics
      const entries =
        isObject(aggregate) && Array.isArray(aggregate.entries) ? aggregate.entries : []
      const root = entries.find(
        (entry) =>
          isObject(entry) && Array.isArray(entry.operations) && entry.operations.length === 0,
      )
      const rootDiagnostics = record.diagnostics
      // The root envelope and the attributed capture can contain the same evidence.
      if (
        isObject(root) &&
        isObject(rootDiagnostics) &&
        ['stderr', 'stderrBytes', 'stderrTruncated'].every(
          (key) => root[key] === rootDiagnostics[key],
        )
      ) {
        delete details.diagnostics
      } else if (details.diagnostics !== undefined) {
        const unseen = remaining(details.diagnostics, [])
        if (unseen === undefined) delete details.diagnostics
        else details.diagnostics = unseen
      }
      if (isObject(aggregate) && Array.isArray(aggregate.entries)) {
        const unseen = entries.flatMap((entry) => {
          if (
            !isObject(entry) ||
            !Array.isArray(entry.operations) ||
            !entry.operations.every((part) => typeof part === 'string')
          )
            return [entry]
          const value = remaining(entry, entry.operations as string[])
          return value === undefined ? [] : [value]
        })
        if (unseen.length === 0 && !aggregate.truncated) delete details.runDiagnostics
        else details.runDiagnostics = { ...aggregate, entries: unseen }
      }
      view = details
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

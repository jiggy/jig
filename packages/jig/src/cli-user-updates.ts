import {
  USER_UPDATES_LIMITS as limits,
  type UserUpdate,
  validateUserUpdate,
} from '@jigging/user-updates'
import { privateCliHeading } from './cli-presentation.js'
import { PrivateRunModel } from './cli-run-model.js'
import { canonicalJson, type JsonValue } from './json.js'

export {
  privateTerminalWidth,
  privateTruncateUpdate,
  privateUpdateText,
} from './private-terminal-text.js'

import { privateUpdateText } from './private-terminal-text.js'

type Activity = Extract<UserUpdate, { kind: 'activity' }>
type Slot = { readonly attribution: string; value: Activity }
type Source = {
  active: boolean
  readonly slots: Map<string, Slot>
  readonly publishers: Set<string>
}
export interface PrivateUserUpdateSource {
  accept(value: JsonValue, publisher?: string): boolean
  retire(reason?: string): void
}

/** Retained state belongs to connected lifetimes. Notices belong to the presenter. */
export class PrivateCliUserUpdates {
  #slots = new Map<Slot, Slot>()
  #sources = new Set<Source>()
  #stopped = false
  #records = 0
  #bytes = 0
  #notices = 0
  #noticeBytes = 0
  constructor(
    readonly notice: (text: string) => boolean,
    readonly changed: (plainText?: string, project?: () => string | undefined) => boolean,
    readonly unavailable: (text: string) => void,
    readonly color: () => boolean = () => false,
    readonly model: PrivateRunModel = new PrivateRunModel(),
  ) {}

  open(port: string, compact = false): PrivateUserUpdateSource {
    const attribution = compact ? 'Flow' : `Flow update [${port}]`
    const source: Source = { active: !this.#stopped, slots: new Map(), publishers: new Set() }
    if (source.active) this.#sources.add(source)
    const retire = (reason?: string) => {
      if (!source.active) return
      source.active = false
      this.#sources.delete(source)
      const hadSlots = source.slots.size > 0
      for (const slot of source.slots.values()) this.#slots.delete(slot)
      source.slots.clear()
      for (const publisher of source.publishers)
        this.model.freeze(publisher, reason ?? 'Observation ended')
      if (!this.#stopped && reason) this.unavailable(`  ${attribution}: ${reason}\n`)
      const ended =
        hadSlots && !reason ? `  ${attribution}: Live activity updates ended.\n` : undefined
      this.changed(ended, () => (this.#stopped ? undefined : ended))
    }
    return {
      retire,
      accept: (input, publisher = 'root') => {
        if (!source.active || this.#stopped) return false
        let value: UserUpdate
        try {
          value = validateUserUpdate(input)
        } catch {
          retire('Updates unavailable: contract violation.')
          return false
        }
        this.#records++
        source.publishers.add(publisher)
        this.#bytes += canonicalJson(value as JsonValue).byteLength
        if (this.#records > limits.attempts || this.#bytes > limits.trafficBytes) {
          retire('Updates incomplete: observation limit reached.')
          return false
        }
        const localAttribution =
          publisher === 'root' ? attribution : this.model.sourceLabel(publisher)
        const localId = 'id' in value ? JSON.stringify([publisher, value.id]) : ''
        if (value.kind === 'view' || value.kind === 'retire-view') {
          const previous =
            value.kind === 'view'
              ? this.model.views.get(JSON.stringify([publisher, value.id]))?.value
              : undefined
          try {
            this.model.acceptView(publisher, value)
          } catch (error) {
            retire(
              `Updates incomplete: ${error instanceof Error ? error.message : 'view contract violation'}.`,
            )
            return false
          }
          if (
            value.kind === 'view' &&
            (previous === undefined ||
              previous.title !== value.title ||
              previous.summary !== value.summary)
          ) {
            if (
              !this.changed(
                this.#message(
                  localAttribution,
                  `${privateUpdateText(value.title)}\n${privateUpdateText(value.summary)}`,
                ),
              )
            ) {
              retire('Updates incomplete: presentation limit reached.')
              return false
            }
          }
        } else if (value.kind === 'notice') {
          this.#notices++
          const payloadBytes = canonicalJson(value as JsonValue).byteLength
          this.#noticeBytes += payloadBytes
          if (
            this.#notices > limits.notices ||
            this.#noticeBytes > limits.noticeBytes ||
            !this.model.acceptNotice(publisher, value.severity ?? 'info', value.text, payloadBytes)
          ) {
            retire('Updates incomplete: notice observation limit reached.')
            return false
          }
          const importance =
            value.severity === 'error' || value.severity === 'warning'
              ? `  ${privateCliHeading(`${attribution}-reported ${value.severity}:`, value.severity, this.color())}\n`
              : ''
          const text = importance + this.#message(localAttribution, privateUpdateText(value.text))
          let attention: PrivateRunModel['attention'][number] | undefined
          if (
            (value.severity === 'error' || value.severity === 'warning') &&
            !this.model.addAttention(
              localAttribution,
              value.text,
              value.severity === 'error' ? 2 : 1,
              false,
              this.color(),
            )
          ) {
            // The reserved host explanation is committed independently of a clipped sticky cause.
            retire('Updates incomplete: additional Flow reports unavailable.')
            return false
          }
          if (value.severity === 'error' || value.severity === 'warning')
            attention = this.model.attention.at(-1)
          if (
            !(value.severity === 'error' || value.severity === 'warning'
              ? this.changed()
              : this.notice(text))
          ) {
            if (attention) attention.committed = false
            retire('Updates incomplete: presentation limit reached.')
            return false
          }
        } else if (value.kind === 'clear') {
          const slot = source.slots.get(localId)
          if (slot !== undefined) {
            this.#slots.delete(slot)
            source.slots.delete(localId)
            this.model.activity(publisher, value)
            if (!this.changed()) {
              retire('Updates incomplete: presentation limit reached.')
              return false
            }
          }
        } else {
          let slot = source.slots.get(localId)
          const previous = slot?.value
          if (slot === undefined) {
            if (this.#slots.size >= limits.slots) {
              retire('Updates incomplete: activity limit reached.')
              return false
            }
            slot = {
              attribution:
                publisher === 'root' ? (compact ? 'Flow' : `Flow ${port}`) : localAttribution,
              value,
            }
            source.slots.set(localId, slot)
            this.#slots.set(slot, slot)
          } else {
            if (slot.value.operationId !== value.operationId) {
              retire('Updates unavailable: activity call association changed.')
              return false
            }
            slot.value = value
          }
          this.model.activity(publisher, value)
          const meaningful =
            previous === undefined ||
            previous.label !== value.label ||
            previous.detail !== value.detail ||
            previous.progress?.unit !== value.progress?.unit
          const appearance = slot
          if (
            !this.changed(meaningful ? `  ${this.#label(slot)}\n` : undefined, () => {
              const latest = source.slots.get(localId)
              return source.active &&
                !this.#stopped &&
                latest === appearance &&
                latest.value.label === value.label &&
                latest.value.progress?.unit === value.progress?.unit
                ? `  ${this.#label(latest)}\n`
                : undefined
            })
          ) {
            retire('Updates incomplete: presentation limit reached.')
            return false
          }
        }
        return true
      },
    }
  }

  stop(): void {
    this.#stopped = true
    for (const source of this.#sources) {
      source.active = false
      source.slots.clear()
    }
    this.#sources.clear()
    this.#slots.clear()
    this.model.stop()
    this.changed()
  }

  get labels(): readonly string[] {
    return [...this.#slots.values()].map((slot) => this.#label(slot))
  }

  #label(slot: Slot): string {
    return `${privateCliHeading(`${slot.attribution}:`, 'info', this.color())} ${privateUpdateText(slot.value.label)}${this.#count(slot)}${slot.value.detail === undefined ? '' : `\n    ${privateUpdateText(slot.value.detail).replaceAll('\n', '\n    ')}`}`
  }

  #message(attribution: string, text: string): string {
    return (
      text
        .split('\n')
        .map((line, index) =>
          index === 0
            ? `  ${privateCliHeading(`${attribution}:`, 'info', this.color())} ${line}`
            : `    ${line}`,
        )
        .join('\n') + '\n'
    )
  }

  #count(slot: Slot): string {
    const p = slot.value.progress
    const count =
      p === undefined
        ? ''
        : ` (${p.completed}${p.total === undefined ? '' : `/${p.total}`}${p.unit === undefined ? '' : ` ${privateUpdateText(p.unit)}`})`
    return count
  }
}

import {
  USER_UPDATES_LIMITS as limits,
  type UserUpdate,
  validateUserUpdate,
} from '@jigging/user-updates'
import { canonicalJson, type JsonValue } from './json.js'

export function privateUpdateText(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) =>
    character === '\n'
      ? character
      : [...character]
          .map((unit) => `\\u${unit.codePointAt(0)!.toString(16).padStart(4, '0')}`)
          .join(''),
  )
}

export function privateTerminalWidth(text: string): number {
  return (globalThis as unknown as { Bun: { stringWidth(text: string): number } }).Bun.stringWidth(
    text,
  )
}

export function privateTruncateUpdate(text: string, columns: number): string {
  if (privateTerminalWidth(text) <= columns) return text
  if (columns < 3) return '.'.repeat(Math.max(0, columns))
  let result = ''
  // Grapheme boundaries avoid cutting a combining sequence or an emoji cluster.
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    text,
  )) {
    if (privateTerminalWidth(result + segment) > columns - 3) break
    result += segment
  }
  return `${result}...`
}

type Activity = Extract<UserUpdate, { kind: 'activity' }>
type Slot = { readonly attribution: string; value: Activity }
type Source = { active: boolean; readonly slots: Map<string, Slot> }
export interface PrivateUserUpdateSource {
  accept(value: JsonValue): boolean
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
  ) {}

  open(port: string, compact = false): PrivateUserUpdateSource {
    const attribution = compact ? 'Flow' : `Flow update [${port}]`
    const source: Source = { active: !this.#stopped, slots: new Map() }
    if (source.active) this.#sources.add(source)
    const retire = (reason?: string) => {
      if (!source.active) return
      source.active = false
      this.#sources.delete(source)
      const hadSlots = source.slots.size > 0
      for (const slot of source.slots.values()) this.#slots.delete(slot)
      source.slots.clear()
      if (!this.#stopped && reason) this.unavailable(`  ${attribution}: ${reason}\n`)
      const ended =
        hadSlots && !reason ? `  ${attribution}: Live activity updates ended.\n` : undefined
      this.changed(ended, () => (this.#stopped ? undefined : ended))
    }
    return {
      retire,
      accept: (input) => {
        if (!source.active || this.#stopped) return false
        let value: UserUpdate
        try {
          value = validateUserUpdate(input)
        } catch {
          retire('Updates unavailable: contract violation.')
          return false
        }
        this.#records++
        this.#bytes += canonicalJson(value as JsonValue).byteLength
        if (this.#records > limits.attempts || this.#bytes > limits.trafficBytes) {
          retire('Updates incomplete: observation limit reached.')
          return false
        }
        if (value.kind === 'notice') {
          this.#notices++
          this.#noticeBytes += canonicalJson(value as JsonValue).byteLength
          const text =
            privateUpdateText(value.text)
              .split('\n')
              .map((line) => `  ${attribution}: ${line}`)
              .join('\n') + '\n'
          if (
            this.#notices > limits.notices ||
            this.#noticeBytes > limits.noticeBytes ||
            !this.notice(text)
          ) {
            retire('Updates incomplete: presentation limit reached.')
            return false
          }
        } else if (value.kind === 'clear') {
          const slot = source.slots.get(value.id)
          if (slot !== undefined) {
            this.#slots.delete(slot)
            source.slots.delete(value.id)
            const cleared = `  ${attribution}: Activity ended.\n`
            if (
              !this.changed(cleared, () =>
                source.active && !this.#stopped && !source.slots.has(value.id)
                  ? cleared
                  : undefined,
              )
            ) {
              retire('Updates incomplete: presentation limit reached.')
              return false
            }
          }
        } else {
          let slot = source.slots.get(value.id)
          const previous = slot?.value
          if (slot === undefined) {
            if (this.#slots.size >= limits.slots) {
              retire('Updates incomplete: activity limit reached.')
              return false
            }
            slot = { attribution: compact ? 'Flow' : `Flow ${port}`, value }
            source.slots.set(value.id, slot)
            this.#slots.set(slot, slot)
          } else slot.value = value
          const meaningful =
            previous === undefined ||
            previous.label !== value.label ||
            previous.progress?.unit !== value.progress?.unit
          const appearance = slot
          if (
            !this.changed(meaningful ? `  ${this.#label(slot)}\n` : undefined, () => {
              const latest = source.slots.get(value.id)
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
    this.changed()
  }

  get labels(): readonly string[] {
    return [...this.#slots.values()].map((slot) => this.#label(slot))
  }

  project(index: number, columns: number): string | undefined {
    const slot = [...this.#slots.values()][index]
    if (slot === undefined) return undefined
    const prefix = `${slot.attribution}: `,
      count = this.#count(slot)
    const room = columns - privateTerminalWidth(prefix + count)
    return room < 3
      ? undefined
      : prefix + privateTruncateUpdate(privateUpdateText(slot.value.label), room) + count
  }

  #label(slot: Slot): string {
    return `${slot.attribution}: ${privateUpdateText(slot.value.label)}${this.#count(slot)}`
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

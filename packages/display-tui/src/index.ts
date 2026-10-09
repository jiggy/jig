import { NativeRenderer } from './native.js'
import { ViewerInput } from './input.js'
import { ViewerModel } from './viewer-model.js'
import { createInlineOwner } from './inline-owner.js'
import type { InlineDisplay, TuiDisplay, TuiOptions, TuiViewport } from './types.js'
import type { DisplaySnapshotEnvelope } from '@jigging/display-model'

export type {
  InlineDisplay,
  TuiDisplay,
  TuiOptions,
  TuiTheme,
  TuiViewport,
  PreviewIntent,
  PreviewService,
} from './types.js'

declare const preparedSupport: unique symbol
/** Prepared native support is opaque and owns neither a terminal nor a viewer. */
export interface TuiSupport {
  readonly [preparedSupport]: true
}
const support = new WeakMap<TuiSupport, typeof import('@opentui/core')>()
export class TuiSupportError extends Error {
  constructor() {
    super('The terminal renderer cannot load its required native support.')
    this.name = 'TuiSupportError'
  }
}

/** Native initialization is explicit. Inline, text and model imports remain inert. */
export async function prepareTui(): Promise<TuiSupport> {
  try {
    const core = await import('@opentui/core')
    const buffer = core.OptimizedBuffer.create(1, 1, 'unicode')
    buffer.destroy()
    const prepared = Object.freeze({}) as TuiSupport
    support.set(prepared, core)
    return prepared
  } catch {
    throw new TuiSupportError()
  }
}

class Inspector implements TuiDisplay {
  #closed = false
  #generation = 0
  #frame: Promise<{ text: string }> | undefined
  readonly #input: ViewerInput
  constructor(
    readonly model: ViewerModel,
    readonly native: NativeRenderer,
    options: Pick<TuiOptions, 'onChange' | 'onAction' | 'interactionAllowed'>,
  ) {
    this.#input = new ViewerInput(
      model,
      () => {
        if (!this.#closed) options.onChange?.()
      },
      (action) => {
        if (!this.#closed) options.onAction?.(action)
      },
      () => !this.#closed && (options.interactionAllowed?.() ?? true),
    )
  }
  update(snapshot: DisplaySnapshotEnvelope): void {
    if (this.#closed) return
    this.#generation++
    this.model.update(snapshot)
  }
  input(bytes: Uint8Array): void {
    if (!this.#closed) this.#input.input(bytes)
  }
  frame(viewport: TuiViewport): Promise<{ text: string }> {
    if (this.#closed) return Promise.resolve({ text: '' })
    if (this.#frame) return this.#frame
    if (
      !Number.isFinite(viewport.columns) ||
      !Number.isFinite(viewport.rows) ||
      viewport.columns < 1 ||
      viewport.rows < 1
    )
      return Promise.resolve({ text: '' })
    const generation = this.#generation
    const task = this.native
      .frame(viewport.columns, viewport.rows, this.#input.state, this.#input.scroll, viewport.color)
      .then((frame) => {
        if (this.#closed || generation !== this.#generation) {
          if (!this.#closed) this.native.invalidateFrame()
          return { text: '' }
        }
        this.#input.frame(frame.references, frame.scroll)
        return { text: frame.text }
      })
      .finally(() => {
        if (this.#frame === task) this.#frame = undefined
      })
    this.#frame = task
    return task
  }
  handoffInline(): InlineDisplay | undefined {
    if (this.#closed) return
    this.#closed = true
    this.#generation++
    this.#input.dispose()
    this.native.close()
    return createInlineOwner(this.model)
  }
  dispose(): void {
    if (this.#closed) return
    this.#closed = true
    this.#generation++
    this.#input.dispose()
    this.native.close()
    this.model.close()
  }
}

export async function createTui(prepared: TuiSupport, options: TuiOptions): Promise<TuiDisplay> {
  const core = support.get(prepared)
  if (!core) throw new TuiSupportError()
  let display: Inspector | undefined
  const { snapshot, theme, preview, onChange, onAction, interactionAllowed } = options
  const model = new ViewerModel(snapshot, {
    ...(theme === undefined ? {} : { theme }),
    ...(preview === undefined ? {} : { preview }),
    onChange: () => {
      if (display) onChange?.()
    },
  })
  try {
    const native = await NativeRenderer.create(core, model, 80, 24)
    display = new Inspector(model, native, {
      ...(onChange === undefined ? {} : { onChange }),
      ...(onAction === undefined ? {} : { onAction }),
      ...(interactionAllowed === undefined ? {} : { interactionAllowed }),
    })
    return display
  } catch (error) {
    model.close()
    throw error
  }
}

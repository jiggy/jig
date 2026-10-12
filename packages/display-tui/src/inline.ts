import { createInlineOwner } from './inline-owner.js'
import { ViewerModel } from './presentation/viewer-model.js'
import type { InlineDisplay, InlineOptions } from './types.js'

export type { InlineDisplay, InlineOptions } from './types.js'
/** Non-native semantic inline projection; never reads stdin or emits bytes itself. */
export function createInlineDisplay(options: InlineOptions): InlineDisplay {
  return createInlineOwner(new ViewerModel(options.snapshot, options))
}

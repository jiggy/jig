import type { DisplaySnapshotEnvelope } from '@jigging/display-model'
import { viewerFrame } from './projection.js'
import type { InlineDisplay, TuiViewport } from './types.js'
import type { ViewerModel } from './viewer-model.js'

/** Transfer a private viewer; public inline declarations expose no adapter state. */
export function createInlineOwner(model: ViewerModel): InlineDisplay {
  model.releaseViewerEffects()
  let disposed = false
  return {
    update(snapshot: DisplaySnapshotEnvelope): void {
      if (!disposed) model.update(snapshot)
    },
    frame(viewport: TuiViewport): { lines: string[] } {
      if (
        disposed ||
        !Number.isFinite(viewport.columns) ||
        !Number.isFinite(viewport.rows) ||
        viewport.columns < 1 ||
        viewport.rows < 1
      )
        return { lines: [] }
      const frame = viewerFrame(
        model,
        viewport.columns,
        viewport.rows,
        viewport.color,
        false,
        model.local.scroll,
        model.local.anchor,
      )
      model.local.scroll = frame.scroll ?? model.local.scroll
      model.local.anchor = frame.anchor
      return { lines: [...frame.lines] }
    },
    dispose(): void {
      disposed = true
      model.close()
    },
  }
}

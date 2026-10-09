import type { DisplayPreviewReply, DisplaySnapshotEnvelope } from '@jigging/display-model'

export type TuiTheme = 'one-dark' | 'one-light' | 'macchiato'
export type TuiViewport = Readonly<{ columns: number; rows: number; color: boolean }>
export type PreviewIntent = Readonly<{ artifactId: string; captureGeneration: string }>
export type PreviewService = (intent: PreviewIntent) => Promise<DisplayPreviewReply | undefined>
export type TuiOptions = Readonly<{
  snapshot: DisplaySnapshotEnvelope
  theme?: TuiTheme
  preview?: PreviewService
  onChange?: () => void
  onAction?: (action: 'close' | 'interrupt') => void
  interactionAllowed?: () => boolean
}>

/** No stream, native support or execution owner is exposed by the inspector. */
export interface TuiDisplay {
  update(snapshot: DisplaySnapshotEnvelope): void
  input(bytes: Uint8Array): void
  frame(viewport: TuiViewport): Promise<{ text: string }>
  handoffInline(): InlineDisplay | undefined
  dispose(): void
}
export type InlineOptions = Readonly<{ snapshot: DisplaySnapshotEnvelope; theme?: TuiTheme }>
export interface InlineDisplay {
  update(snapshot: DisplaySnapshotEnvelope): void
  frame(viewport: TuiViewport): { lines: string[] }
  dispose(): void
}

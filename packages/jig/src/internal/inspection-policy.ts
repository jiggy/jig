/** Fixed configured-topology presentation bounds. */
export const PRIVATE_FLOW_CONTEXT_LIMITS = Object.freeze({
  targets: 256,
  connections: 1024,
  inlineValueBytes: 4096,
})

/** Fixed working-tree navigation search and source reference bounds. */
export const PRIVATE_FLOW_NAVIGATION_LIMITS = Object.freeze({
  phraseCharacters: 128,
  matches: 12,
  sourceFilesPerCaller: 64,
  sourceBytesPerCaller: 256 * 1024,
  locationsPerHandoff: 4,
})

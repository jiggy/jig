/** Fixed presentation bounds, independent of execution and admission authority. */
export const PRIVATE_FLOW_CONTEXT_LIMITS = Object.freeze({
  sourceBytes: 262144,
  targets: 256,
  connections: 1024,
  filesPerPackage: 128,
  inlineValueBytes: 4096,
})

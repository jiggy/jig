/** Fixed bounds for one local exploration command, never execution authority. */
export const PRIVATE_EXPLORER_LIMITS = Object.freeze({
  requestIdentities: 128,
  httpRequests: 8,
  projectResponses: 2,
  handoffBytes: 2048,
  bodyReadMs: 10_000,
})

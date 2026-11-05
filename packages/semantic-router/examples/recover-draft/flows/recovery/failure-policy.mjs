/** Pure application policy; an error code alone grants no execution authority. */
export function draftFailureAction(stage, code) {
  if (stage === 'primary' && code === 'EXECUTION_FAILED') return 'recover'
  if (stage === 'checkpoint' && code === 'UNAVAILABLE') return 'unavailable'
  if (stage === 'checkpoint' && code === 'RESOURCE_EXHAUSTED') return 'limit'
  return 'propagate'
}


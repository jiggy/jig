import {
  type PrivateChildFlowFilePlan,
  type PrivateFlowFileContext,
  requirePrivateChildFlowFilePlanWrite,
} from './flow-file-context.js'

type State = 'busy' | 'committed' | 'unavailable' | 'absent'
interface Destination {
  readonly caller: PrivateFlowFileContext
  readonly key: string
  state: State
}

/** Caller-local history survives child-row and visible-directory deletion.
 * Recovery fences this caller and never resumes its program. */
export interface PrivateChildFileDestination {
  readonly directory: string
  readonly prefix: string
}
const callers = new WeakMap<PrivateFlowFileContext, Map<string, Destination>>()
const destinations = new WeakMap<PrivateChildFileDestination, Destination>()

export class PrivateChildFileDestinationError extends Error {
  constructor(readonly state: Exclude<State, 'absent'>) {
    super(
      state === 'busy'
        ? 'the caller output folder already has an active child operation'
        : state === 'committed'
          ? 'the caller output folder has already received child files'
          : 'the caller output folder has an unconfirmed child import',
    )
  }
}

export function reservePrivateChildFileDestination(
  caller: PrivateFlowFileContext,
  plan: PrivateChildFlowFilePlan,
): PrivateChildFileDestination | undefined {
  const write = requirePrivateChildFlowFilePlanWrite(plan, caller)
  if (write === null) return undefined
  let claims = callers.get(caller)
  if (claims === undefined) {
    claims = new Map()
    callers.set(caller, claims)
  }
  const key = `${write.into}\0${write.directory}`
  const prior = claims.get(key)
  if (prior !== undefined && prior.state !== 'absent')
    throw new PrivateChildFileDestinationError(prior.state)
  const held: Destination = { caller, key, state: 'busy' }
  const destination = Object.freeze({ directory: write.directory, prefix: write.prefix })
  claims.set(key, held)
  destinations.set(destination, held)
  return destination
}

/** Called only after the existing operation confirms native commit/absence and
 * joins cleanup. An uncertain import ends the caller, never releases its claim. */
export function settlePrivateChildFileDestination(
  destination: PrivateChildFileDestination,
  state: Exclude<State, 'busy'>,
): void {
  const held = destinations.get(destination)
  if (held === undefined || callers.get(held.caller)?.get(held.key) !== held)
    throw new TypeError('child file destination is not the original reservation')
  if (held.state === state) return
  if (held.state !== 'busy' && state !== 'unavailable')
    throw new TypeError('child file destination is already settled')
  held.state = state
}

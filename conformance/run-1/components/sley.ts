import { Flow, RunError, node } from '@jigging/sley'

import {
  OperationError,
  handle,
  type JsonObject,
  type JsonValue,
  type RunContext,
  type RunResult,
} from '../../../packages/flow-sdk/src/index'

interface Request {
  readonly route: 'local' | 'child'
  readonly value: string
}

interface State {
  readonly request: Request
  result?: RunResult
}

await handle(async (run) => {
  try {
    const state = await buildGraph(run).run({ request: parseRequest(run.input) })
    if (state.result === undefined) {
      throw new OperationError('INVALID_RESULT', 'Sley graph produced no FLOW result')
    }
    return state.result
  } catch (error) {
    // Sley preserves handler failures as RunError causes. Keep an existing
    // Run/1 operational classification instead of flattening it to a generic
    // graph execution failure.
    if (error instanceof RunError && error.result.failure.cause instanceof OperationError) {
      throw error.result.failure.cause
    }
    throw error
  }
})

function buildGraph(run: RunContext): Flow<State> {
  const choose = node<State>((context) => {
    context.emit(context.state.request.route)
  })

  const local = node<State>((context) => {
    context.state.result = {
      outcome: 'done',
      output: { value: context.state.request.value.toUpperCase() },
    }
  })

  const child = node<State>(async (context) => {
    context.state.result = await run.callFlow({
      operationId: 'delegate:1',
      slot: 'delegate',
      intent: 'Process the supplied value.',
      input: { value: context.state.request.value },
    })
  })

  choose.link(local, 'local')
  choose.link(child, 'child')
  return new Flow(choose, { name: 'flow-run' })
}

function parseRequest(value: JsonValue): Request {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new OperationError('INVALID_INPUT', 'input must be an object')
  }
  const input = value as JsonObject
  const keys = Object.keys(input).sort()
  if (keys.length !== 2 || keys[0] !== 'route' || keys[1] !== 'value') {
    throw new OperationError('INVALID_INPUT', 'input must contain exactly route and value')
  }
  if ((input.route !== 'local' && input.route !== 'child') || typeof input.value !== 'string') {
    throw new OperationError('INVALID_INPUT', 'input route or value is invalid')
  }
  return { route: input.route, value: input.value }
}

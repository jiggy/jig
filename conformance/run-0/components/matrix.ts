import { handle, OperationError } from '../../../packages/flow-sdk/src/index'

await handle(async (run) => {
  const input = run.input as { case?: unknown }
  switch (input.case) {
    case 'fanout-65': {
      const calls = Array.from({ length: 65 }, (_, index) =>
        run.call({
          operationId: `fanout:${index + 1}`,
          slot: 'sink',
          input: { index },
        }),
      )
      await Promise.allSettled(calls)

      return { outcome: 'done', output: { settled: calls.length } }
    }
    case 'operation-identity': {
      const call = () =>
        run.call({
          operationId: 'shared:1',
          slot: 'sink',
          input: { value: 'same' },
        })
      const [first, second] = await Promise.all([call(), call()])
      const replay = await call()
      let conflict: string | null = null
      try {
        await run.call({
          operationId: 'shared:1',
          slot: 'sink',
          input: { value: 'different' },
        })
      } catch (error) {
        if (!(error instanceof OperationError)) throw error
        conflict = error.code
      }
      return { outcome: 'done', output: { first, second, replay, conflict } }
    }
    case 'cancel-shared-waiter': {
      const controller = new AbortController()
      const call = (signal?: AbortSignal) =>
        run.call(
          {
            operationId: 'shared-cancel:1',
            slot: 'sink',
            input: { value: 'shared' },
          },
          signal === undefined ? undefined : { signal },
        )
      const cancelled = call(controller.signal)
      const survivor = call()
      await run.call({
        operationId: 'release-shared-cancel:1',
        slot: 'control',
        input: null,
      })
      controller.abort()
      let cancellation: string | null = null
      try {
        await cancelled
      } catch (error) {
        if (!(error instanceof OperationError)) throw error
        cancellation = error.code
      }
      return {
        outcome: 'done',
        output: { cancellation, survivor: await survivor },
      }
    }
    case 'uncertain-replay': {
      const call = async (operationId: string) => {
        try {
          return await run.call({
            operationId,
            slot: 'sink',
            input: { value: 'uncertain' },
          })
        } catch (error) {
          if (!(error instanceof OperationError)) throw error
          return error.code
        }
      }
      const first = await call('uncertain:1')
      const replay = await call('uncertain:1')
      const fresh = await call('uncertain:2')
      return { outcome: 'done', output: { first, replay, fresh } }
    }
    case 'request-lifetime': {
      let accepted = 0
      let rejected: string | null = null
      for (let index = 1; index <= 65_537; index += 1) {
        try {
          await run.call({
            operationId: `lifetime:${index}`,
            slot: 'sink',
            input: null,
          })
          accepted += 1
        } catch (error) {
          if (!(error instanceof OperationError)) throw error
          rejected = error.code
        }
      }
      return { outcome: 'done', output: { accepted, rejected } }
    }
    case 'one-flow': {
      const child = await run.call({
        operationId: 'child:1',
        slot: 'child',
        input: null,
      })
      return { outcome: 'done', output: child }
    }
    case 'two-effects': {
      const first = await run.call({
        operationId: 'first:1',
        slot: 'sink',
        input: { sequence: 1 },
      })
      const second = await run.call({
        operationId: 'second:1',
        slot: 'sink',
        input: { sequence: 2 },
      })
      return { outcome: 'done', output: { first, second } }
    }
    case 'cancel-one-call': {
      const controller = new AbortController()
      const child = run.call(
        {
          operationId: 'cancelled-child:1',
          slot: 'child',
          input: null,
        },
        { signal: controller.signal },
      )
      await run.call({
        operationId: 'release-cancel:1',
        slot: 'control',
        input: null,
      })
      controller.abort()
      try {
        await child
        throw new Error('cancelled child unexpectedly completed')
      } catch (error) {
        if (!(error instanceof OperationError) || error.code !== 'CANCELLED') {
          throw error
        }
      }
      return { outcome: 'done', output: 'cancelled-locally' }
    }
    case 'abandoned-call': {
      // Abandon the operation without also creating a language-level
      // unhandled rejection when the SDK closes its owner.
      void run
        .call({
          operationId: 'abandoned-child:1',
          slot: 'child',
          input: null,
        })
        .catch(() => undefined)
      await run.call({
        operationId: 'release-abandon:1',
        slot: 'control',
        input: null,
      })
      return { outcome: 'done', output: 'must-not-succeed' }
    }
    default:
      return { outcome: 'done', output: null }
  }
})

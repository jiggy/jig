import { handle } from '../../../packages/flow-sdk/src/index'

await handle(async (run) => {
  const researchPromise = run.call({
    operationId: 'research:1',
    slot: 'research',
    intent: 'Find a useful comparison target.',
    input: run.input,
  })

  const storedPromise = run.call({
    operationId: 'store:1',
    slot: 'artifact-write',
    input: { source: 'research' },
  })

  const [research, stored] = await Promise.all([researchPromise, storedPromise])
  const missing = await run.call({
    operationId: 'missing:1',
    slot: 'artifact-read',
    input: { uri: 'artifact://missing' },
  })

  return {
    outcome: 'done',
    output: { research, stored, missing },
  }
})

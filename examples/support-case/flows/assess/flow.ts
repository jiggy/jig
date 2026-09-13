import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { assess } = await import('./assess.ts')
  return assess(run)
})

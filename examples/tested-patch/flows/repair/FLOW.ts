import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { repair } = await import('./repair.ts')
  return repair(run)
})

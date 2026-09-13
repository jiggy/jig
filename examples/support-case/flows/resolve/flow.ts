import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { resolve } = await import('./resolve.ts')
  return resolve(run)
})

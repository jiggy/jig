import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { repairFiles } = await import('./files.ts')
  return repairFiles(run)
})

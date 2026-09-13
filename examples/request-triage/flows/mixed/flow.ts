import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { triage } = await import('./triage.ts')
  return triage(run)
})

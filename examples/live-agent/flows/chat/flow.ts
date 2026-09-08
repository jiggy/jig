import { handle } from '@jigging/flow'

await handle(async (run) => {
  const { chat } = await import('./chat.ts')
  return chat(run)
})

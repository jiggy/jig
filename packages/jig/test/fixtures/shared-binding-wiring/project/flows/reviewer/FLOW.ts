import { handle } from '@jigging/flow'

await handle(async ({ input, settings }) => {
  const { scope, purpose, text } = input as { scope: string; purpose: string; text: string }
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const decision = words >= Number(settings.minimumWords) ? 'accept' : 'revise'
  return {
    outcome: 'done',
    output: { scope, purpose, text, words, review: settings.policy, decision },
  }
})

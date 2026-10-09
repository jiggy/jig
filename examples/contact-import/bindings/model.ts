import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  // Client and model selection live in grants/agent.json.
  slots: { native: 'grant:agent' },
})

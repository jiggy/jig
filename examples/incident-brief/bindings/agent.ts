import { defineBinding } from '@jigging/jig'
// Client and model selection live in grants/agent.json.
export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: 'grant:agent' },
})

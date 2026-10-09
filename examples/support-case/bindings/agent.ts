import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  // Example choice, not a Jig default. Select 'codex', 'claude', or 'pi'.
  slots: { native: { kind: 'acp', client: 'codex' } },
})

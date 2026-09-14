import { defineBinding } from '@jigging/jig'
// Editable example selection, not a Jig default. Use a qualified native client.
export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  slots: { native: { kind: 'acp', client: 'codex', maxTurns: 2 } },
})

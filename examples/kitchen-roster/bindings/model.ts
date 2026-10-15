import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:@jigging/agent-acp',
  // The operator chooses the client; omit a model to use that client's configuration.
  slots: { native: { kind: 'acp', client: 'codex' } },
})

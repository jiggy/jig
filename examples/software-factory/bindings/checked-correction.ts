import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:tested-patch-repair-flow',
  settings: { maxProposals: 2 },
  slots: {
    tests: { kind: 'command', test: ['test/project.test.ts'] },
    cli: { kind: 'command', run: 'src/cli.ts' },
  },
})

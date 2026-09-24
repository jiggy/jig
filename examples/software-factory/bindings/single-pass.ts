import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'npm:factory-repair-flow',
  settings: { maxProposals: 1 },
  slots: {
    tests: { kind: 'command', test: ['test/project.test.ts'] },
    cli: { kind: 'command', run: 'src/cli.ts' },
  },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/repair',
  slots: {
    tests: { kind: 'command', test: ['test/project.test.ts'] },
    cli: { kind: 'command', run: 'src/cli.ts' },
  },
})

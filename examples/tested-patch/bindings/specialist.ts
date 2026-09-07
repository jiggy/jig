import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/repair',
  commands: {
    tests: { test: ['test/project.test.ts'] },
    cli: { run: 'src/cli.ts' },
  },
})

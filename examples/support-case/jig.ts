import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: 'binding:support --input @fixtures/duplicate.json --timeout 2m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

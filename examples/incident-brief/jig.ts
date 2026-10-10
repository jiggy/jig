import { defineJig, discover } from '@jigging/jig'
export default defineJig({
  entrypoint: 'binding:brief --input @input.json --timeout 3m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

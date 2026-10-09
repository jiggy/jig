import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:model',
  },
})

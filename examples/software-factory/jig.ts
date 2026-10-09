import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    'binding:factory --input @batch.json --attach source=fixtures --out-new factory-result --timeout 8m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    'binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

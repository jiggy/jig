import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    "binding:code --input '{}' --attach source=fixtures/known --out-new preview-known --timeout 1m",
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:model',
  },
})

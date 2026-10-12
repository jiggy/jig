import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: "binding:code --input '{}' --attach source=fixtures/known --timeout 1m",
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:model',
  },
})

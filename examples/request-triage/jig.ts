import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: 'binding:intake --input @fixtures/labeled.json --out-new triage-result --timeout 1m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:model',
  },
})

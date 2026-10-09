import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    'binding:support --input @fixtures/duplicate.json --out-new support-result --timeout 2m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

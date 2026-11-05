import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: 'binding:outer --input @input.json --timeout 3m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  defaultProviders: { 'https://jig.md/contracts/agent-run': 'binding:agent' },
})

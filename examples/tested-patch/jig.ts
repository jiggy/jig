import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    'binding:repair --input @issue.json --attach source=fixtures/log-report --out-new repair-result --timeout 5m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
  defaultProviders: {
    'https://jig.md/contracts/agent-run': 'binding:agent',
  },
})

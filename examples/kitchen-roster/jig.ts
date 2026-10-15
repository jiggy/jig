import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint: "binding:roster --input '{}' --attach source=fixtures/feasible --timeout 3m",
  flows: discover('flows'),
  bindings: discover('bindings'),
})

import { defineJig, discover } from '@jigging/jig'

export default defineJig({
  entrypoint:
    'binding:organise --input \'{"albumTitle":"Family moments · 2025"}\' --attach source=fixtures/photos --timeout 2m',
  flows: discover('flows'),
  bindings: discover('bindings'),
  grants: discover('grants'),
})

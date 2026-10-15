import { defineJig } from '@jigging/jig'

// The first review selects only the code route, so no Agent setup is needed.
// The README shows how to select the other implementations when you want them.
export default defineJig({
  entrypoint: "binding:code --input '{}' --attach source=fixtures/known --timeout 1m",
  flows: [
    'flows/import',
    'flows/read-contacts',
    'flows/map-code',
    'flows/convert',
    'flows/export-preview',
  ],
  bindings: [
    'bindings/code.ts',
  ],
})

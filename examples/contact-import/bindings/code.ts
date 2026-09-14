import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/import',
  slots: { mapper: 'flow:flows/map-code', converter: 'flow:flows/convert' },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/import',
  slots: { mapper: 'flow:flows/map-agent', converter: 'flow:flows/convert' },
})

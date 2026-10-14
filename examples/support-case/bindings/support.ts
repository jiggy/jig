import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/resolve',
  slots: { assessment: 'flow:flows/assess', credit: 'flow:flows/check-credit' },
})

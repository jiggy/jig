import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/intake',
  slots: { classifier: 'flow:flows/agent' },
})

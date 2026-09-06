import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/repair',
  slots: { candidate: 'flow:flows/evaluate' },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/producer',
  slots: { review: 'binding:standard', 'post-edit': 'binding:standard' },
})

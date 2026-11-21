import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/offer',
  slots: {
    sample: { target: 'binding:shared-producer', attachments: { review: { create: true } } },
  },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/book',
  slots: {
    producer: { target: 'binding:shared-producer', attachments: { review: { create: true } } },
  },
})

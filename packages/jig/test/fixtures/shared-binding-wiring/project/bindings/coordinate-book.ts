import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/book',
  slots: {
    production: { target: 'binding:shared-producer', attachments: { review: { create: true } } },
  },
})

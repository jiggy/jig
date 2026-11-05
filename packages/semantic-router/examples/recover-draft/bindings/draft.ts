import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/draft',
  slots: { material: { target: 'flow:flows/material', attachments: { work: { create: true } } } },
})

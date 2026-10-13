import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/organise',
  slots: {
    group: 'binding:group',
    'copy-photos': {
      target: 'flow:flows/copy-photos',
      attachments: {
        source: { from: 'source' },
        files: { into: 'photos', directory: 'copies' },
      },
    },
    'contact-sheet': {
      target: 'flow:flows/contact-sheet',
      attachments: {
        source: { from: 'source' },
        files: { into: 'photos', directory: 'overview' },
      },
    },
  },
})

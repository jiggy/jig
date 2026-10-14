import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/roster',
  slots: {
    'read-roster': {
      target: 'flow:flows/read-roster',
      attachments: { source: { from: 'source' } },
    },
    'propose-roster': 'binding:propose',
    'check-roster': 'flow:flows/check-roster',
    'export-roster': {
      target: 'flow:flows/export-roster',
      attachments: { files: { into: 'files', directory: 'schedule' } },
    },
  },
})

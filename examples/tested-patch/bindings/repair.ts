import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/project',
  slots: {
    reader: { target: 'flow:flows/read-project', attachments: { source: { from: 'source' } } },
    repair: 'binding:specialist',
    checker: 'flow:flows/check-repair',
    exporter: {
      target: 'flow:flows/export-patch',
      attachments: { files: { into: 'deliverables', directory: 'review' } },
    },
  },
})

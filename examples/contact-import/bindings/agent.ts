import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/import',
  slots: {
    reader: { target: 'flow:flows/read-contacts', attachments: { source: { from: 'source' } } },
    mapper: 'flow:flows/map-agent',
    converter: 'flow:flows/convert',
    exporter: {
      target: 'flow:flows/export-preview',
      attachments: { files: { into: 'preview', directory: 'contacts' } },
    },
  },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/recovery',
  slots: {
    primary: 'binding:draft',
    evaluate: { target: 'flow:flows/evaluate', attachments: { source: { supplied: 'read' } } },
    repair: { target: 'flow:flows/repair', attachments: { source: { supplied: 'read' } } },
    selector: 'npm:@jigging/semantic-router',
    finish: {
      target: 'flow:flows/finish',
      attachments: { source: { supplied: 'read' }, report: { create: true } },
    },
  },
})

import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/project',
  slots: { repair: 'binding:specialist', monitor: 'flow:flows/monitor' },
})

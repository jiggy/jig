import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/factory',
  slots: {
    router: 'flow:flows/router',
    'single-pass': 'binding:single-pass',
    'checked-correction': 'binding:checked-correction',
  },
})

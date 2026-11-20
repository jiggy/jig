import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/reviewer',
  settings: { policy: 'standard', minimumWords: 1 },
})

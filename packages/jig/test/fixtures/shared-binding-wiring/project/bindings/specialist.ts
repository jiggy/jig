import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/reviewer',
  settings: { policy: 'specialist', minimumWords: 2 },
})

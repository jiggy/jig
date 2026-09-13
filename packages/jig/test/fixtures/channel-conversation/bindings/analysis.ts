import { defineBinding } from '@jigging/jig'

export default defineBinding({
  package: 'flows/investigate',
  slots: { analysis: 'flow:flows/analysis', dataset: 'flow:flows/dataset' },
})

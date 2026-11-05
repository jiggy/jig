import { expect, test } from 'bun:test'
import { validateReportingMessage } from '@jigging/reporting'
import { selectionView, selectionViewOptions } from '../src/dashboard.js'
import { routingInput } from '../src/decision.js'

test('Selection bounds previews while preserving full candidate descriptions', () => {
  const request = routingInput({
    task: 'Choose a suitable prose method. ' + '\u0001'.repeat(1024),
    candidates: Array.from({ length: 16 }, (_, index) => ({
      id: `method-${index}`, description: '\u0001'.repeat(192),
    })),
  })
  const item = validateReportingMessage({
    kind: 'view', id: 'selection', ...selectionViewOptions(request),
    ...selectionView(request, { outcome: 'done', output: { candidateId: null, reason: 'No suitable method.' } }),
  }) as any
  expect(item.sections[0].blocks[1].rows).toHaveLength(8)
  expect(item.sections[0].blocks[1].total).toBe(16)
  expect(item.summary).toContain('No fallback or dispatch')
  expect(item.sections[0].blocks[1].rows[0].details[0].text).toBe(request.candidates[0]!.description)
  expect(item.sections[0].blocks[1].rows[0].cells.description).toBe(request.candidates[0]!.description)
  expect(item.target.definitionId).toBe('candidate-selection')
  expect(item.target.label).toBe('16 eligible methods')
  expect(item.target.scopeLabel).toBe('Candidates')
})

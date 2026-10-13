import { expect, test } from 'bun:test'
import { PrivateRunModel } from '../../src/cli-run-model.js'
import { PrivateCliUserUpdates } from '../../src/cli-user-updates.js'
import {
  assertExplicitObservation,
  assertFactoryPrefix,
  assertTypedObservation,
  factorySummaries,
  lostObservation,
} from '../fixtures/factory-observation.js'

test('factory automatic observation accepts complete views or exact truthful loss and rejects malformed evidence', () => {
  const render = (mode: 'clean' | 'lagged', unchanged = false, receive = true) => {
    const model = new PrivateRunModel()
    const output: string[] = []
    const updates = new PrivateCliUserUpdates(
      (text) => {
        output.push(text)
        return true
      },
      (text) => {
        if (text !== undefined) output.push(text)
        return true
      },
      (text) => {
        model.setIncomplete('Live observation is incomplete; inspect the final result')
        output.push(`  Jig — observation incomplete:\n    ${text}`)
      },
      () => false,
      model,
    )
    const source = updates.open('progress', true)
    if (receive) {
      for (const [title, summaries] of Object.entries(factorySummaries))
        expect(
          source.accept({
            kind: 'view',
            id: title.toLowerCase(),
            title,
            summary: summaries[unchanged ? 1 : 0],
            sections: [],
          }),
        ).toBeTrue()
      for (const [title, summaries] of Object.entries(factorySummaries))
        expect(
          source.accept({
            kind: 'view',
            id: title.toLowerCase(),
            title,
            summary: summaries[1],
            sections: [],
          }),
        ).toBeTrue()
    }
    source.retire(mode === 'lagged' ? lostObservation : undefined)
    const summary = updates.finalSummary()
    if (summary !== undefined) output.push(summary)
    const retained = [...model.views.values()]
    expect(retained.map((view) => view.value.title)).toEqual(
      receive ? ['Jobs', 'Checks', 'Patches'] : [],
    )
    for (const view of retained) {
      expect(view.value.summary).toBe(
        factorySummaries[view.value.title as keyof typeof factorySummaries][1],
      )
      expect(view.ended).toBe(mode === 'lagged' ? lostObservation : 'Observation ended')
    }
    return output.join('')
  }
  // Use the actual presenter: all three accepted models survive settlement,
  // while plain text contains one selected root and does not replay its purpose.
  const clean = render('clean')
  const unchanged = render('clean', true)
  const loss = render('lagged')
  const unchangedLoss = render('lagged', true)
  const emptyLoss = render('lagged', false, false)
  expect(assertTypedObservation(clean)).toBe('ended')
  expect(assertTypedObservation(unchanged)).toBe('ended')
  expect(assertTypedObservation(loss)).toBe('lagged')
  expect(assertTypedObservation(unchangedLoss)).toBe('lagged')
  expect(assertTypedObservation(emptyLoss)).toBe('lagged')
  expect(unchanged.split(factorySummaries.Jobs[1])).toHaveLength(2)
  expect(clean).not.toContain('Flow / Checks')
  expect(clean).not.toContain('Flow / Patches')
  for (const title of ['HTTP log report', 'Timesheet totals'])
    for (const [transcript, reason] of [
      [clean, 'ended'],
      [loss, 'lagged'],
    ] as const)
      expect(
        assertTypedObservation(
          `${transcript}  Flow: ${title}: Live repair updates stopped (LAGGED). The repair result will still be checked.\n`,
        ),
      ).toBe(reason)
  const guidance = `  Jig — observation incomplete:\n      Flow: ${lostObservation}\n`
  for (const altered of [
    '',
    '  Flow: Jobs\n    Something happened\n',
    loss.replaceAll('LAGGED', 'DISCONNECTED'),
    loss.replaceAll('LAGGED', 'INVALID_INPUT'),
    loss.replaceAll(lostObservation, 'Updates unavailable: contract violation.'),
    loss.replace('  Jig — observation incomplete:\n', ''),
    loss.replace(`      Flow: ${lostObservation}\n`, ''),
    loss.replace(`Flow / Jobs: ${lostObservation}`, 'Flow / Jobs: Observation ended'),
    loss.replace('  Flow / Jobs:', '  Flow / Unknown:'),
    loss.replace(factorySummaries.Jobs[1], 'Unknown retained summary'),
    clean.replaceAll(factorySummaries.Jobs[1], factorySummaries.Jobs[0]),
    clean.replaceAll('Observation ended', 'No end evidence'),
    clean.replace(
      'application reports remain provisional',
      'application reports are authoritative',
    ),
    loss.replace(
      'Live observation is incomplete; inspect the final result',
      'Observation is complete',
    ),
    `${unchanged}    ${factorySummaries.Jobs[1]}\n`,
    `${clean}  Flow / Checks: Observation ended; application reports remain provisional\n    ${factorySummaries.Checks[1]}\n`,
    `${clean}  Flow: Checks\n    ${factorySummaries.Checks[1]}\n`,
    `${clean}  Jig — observation incomplete:\n`,
    `${clean}  Flow: Unknown observation LAGGED\n`,
    `${loss}  Flow: Unknown observation LAGGED\n`,
    `${loss}  Flow: unknown observation incomplete\n`,
    `${loss}  Jig — observation incomplete:\n`,
    `${loss}      Flow: ${lostObservation}\n`,
    loss.replace(
      '  Jig — observation incomplete:\n',
      '  Jig — observation incomplete:\n    Unknown context\n',
    ),
    `${loss}${guidance}`,
    `  Flow / Jobs (Observation ended):\n    ${factorySummaries.Jobs[1]}\n`,
    `${loss}Updates incomplete: unexpected failure\n`,
    `${loss}\u001b[31m`,
  ])
    expect(() => assertTypedObservation(altered)).toThrow()
})

test('factory explicit observation preserves exact channel ordering and rejects malformed evidence', () => {
  const begin = { type: 'begin', channel: 'progress', startSequence: 1 }
  const data = {
    type: 'data',
    channel: 'progress',
    sequence: 1,
    value: {
      kind: 'notice',
      text: 'Software factory: 2 requested repairs. No checked patches yet. Jobs contains goals and scope; Checks contains evidence; Patches contains candidates for human review. Changes are not applied.',
    },
  }
  const end = { type: 'end', channel: 'progress', status: 'closed', lastSequence: 1 }
  const lost = { type: 'end', channel: 'progress', status: 'failed', code: 'LAGGED' }
  const terminal = {
    type: 'terminal',
    result: { status: 'succeeded', outcome: 'done', delivery: { status: 'written' } },
  }
  const encode = (records: unknown[]) =>
    records.map((record) => JSON.stringify(record)).join('\n') + '\n'
  const clean = assertExplicitObservation(encode([begin, data, end, terminal]))
  expect(clean.status).toBe('closed')
  expect(clean.terminal).toEqual(terminal.result)
  expect(clean.updates).toEqual([data.value])
  assertFactoryPrefix(clean.updates, 'checked', [])
  for (const prefix of [[], [data]]) {
    const loss = assertExplicitObservation(encode([begin, ...prefix, lost, terminal]))
    expect(loss.status).toBe('lagged')
    assertFactoryPrefix(loss.updates, 'checked', [])
  }
  for (const altered of [
    [],
    [begin, terminal],
    [data, begin, end, terminal],
    [begin, end, data, terminal],
    [begin, data, terminal, end],
    [begin, begin, data, end, terminal],
    [begin, data, end, end, terminal],
    [begin, data, end, terminal, terminal],
    [{ ...begin, startSequence: 2 }, data, end, terminal],
    [{ ...begin, channel: 'other' }, data, end, terminal],
    [begin, { ...data, sequence: 2 }, end, terminal],
    [begin, data, data, end, terminal],
    [begin, { ...data, channel: 'other' }, end, terminal],
    [begin, { ...data, value: { kind: 'notice', text: '' } }, end, terminal],
    [begin, { ...data, value: { kind: 'notice', text: 'valid', authority: true } }, end, terminal],
    [begin, data, { ...end, lastSequence: 2 }, terminal],
    [begin, data, { ...end, code: 'LAGGED' }, terminal],
    [begin, data, { ...lost, lastSequence: 1 }, terminal],
    [begin, data, { ...lost, code: 'DISCONNECTED' }, terminal],
    [begin, data, { ...lost, code: 'INVALID_INPUT' }, terminal],
    [begin, data, { ...lost, channel: 'other' }, terminal],
    [begin, data, { ...lost, status: 'closed' }, terminal],
    [begin, data, end, { ...terminal, result: null }],
  ])
    expect(() => assertExplicitObservation(encode(altered))).toThrow()
  expect(() => assertExplicitObservation(encode([begin, data, end, terminal]).trimEnd())).toThrow()
  for (const value of [
    { kind: 'notice', text: 'Unknown application' },
    { kind: 'activity', id: 'unknown', label: 'Invented repair' },
    { kind: 'activity', id: 'factory:logs', label: 'Invented repair' },
    {
      kind: 'activity',
      id: 'factory:logs',
      label: 'HTTP log report: invoking',
      operationId: 'unknown',
    },
    {
      kind: 'activity',
      id: 'factory:logs',
      label: 'HTTP log report: invoking',
      progress: { completed: 1, total: 2 },
    },
    { kind: 'clear', id: 'unknown' },
    { kind: 'retire-view', id: 'jobs' },
    { kind: 'view', id: 'unknown', title: 'Jobs', summary: factorySummaries.Jobs[0], sections: [] },
    { kind: 'view', id: 'jobs', title: 'Unknown', summary: factorySummaries.Jobs[0], sections: [] },
    { kind: 'view', id: 'jobs', title: 'Jobs', summary: 'Invented summary', sections: [] },
    { kind: 'view', id: 'jobs', title: 'Jobs', summary: factorySummaries.Jobs[0], sections: [] },
  ])
    expect(() =>
      assertFactoryPrefix(
        assertExplicitObservation(encode([begin, { ...data, value }, lost, terminal])).updates,
        'blocked',
        [],
      ),
    ).toThrow()
})

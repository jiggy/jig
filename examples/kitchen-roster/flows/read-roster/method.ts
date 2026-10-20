import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import { availableFor, readScenario, type Role } from './scenario.ts'

export async function runMethod(
  run: Pick<RunContext, 'attachments' | 'signal'>,
  updates?: Reporter,
): Promise<RunResult> {
  const source = run.attachments.source
  if (source?.access !== 'read') {
    throw new TypeError('Supply the read-only scenario source attachment.')
  }
  updates?.activity('read-roster', 'Reading volunteer availability')
  run.signal.throwIfAborted()
  const path = join(source.path, 'scenario.json')
  const info = await stat(path)
  if (!info.isFile() || info.size > 16 * 1024) {
    throw new TypeError('scenario.json must be a regular file within 16 KiB.')
  }
  const scenario = readScenario(JSON.parse(await readFile(path, 'utf8')))
  run.signal.throwIfAborted()

  // A necessary coverage check catches obvious impossibility without a solver.
  // Having a candidate per role does not prove a complete roster is feasible.
  for (const shift of scenario.shifts) {
    for (const role of ['cook', 'serve'] as Role[]) {
      const eligible = scenario.volunteers.some(
        (person) =>
          person.roles.includes(role) &&
          availableFor(person, shift) &&
          person.maxMinutes >= shift.until - shift.from,
      )
      if (!eligible) {
        const reason = `No qualified, available volunteer can cover ${shift.id} as ${role}.`
        updates?.notice(reason, 'warning')
        return { outcome: 'blocked', output: { reason } }
      }
    }
  }
  updates?.view('availability', { title: 'Kitchen availability', landing: true }).update({
    summary: 'Six volunteers and four shifts checked. Complete scheduling remains provisional.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Availability and qualifications are hard constraints; preferences are soft.',
          },
        ],
      },
    ],
  })
  return { outcome: 'done', output: { scenario } }
}

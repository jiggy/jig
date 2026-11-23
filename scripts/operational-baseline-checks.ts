import assert from 'node:assert/strict'
import { profilePhaseSummary } from '../packages/jig/test/fixtures/private-profile-diagnostics.js'

export function checkInvalidRunTarget(result: { stdout: string; stderr: string }): void {
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /^Error: Run target is invalid\n/)
  assert.match(result.stderr, /use flow:<path>, npm:<package> or binding:<id>/)
  assert.match(result.stderr, /Diagnostic code: JIG_RUN_TARGET_INVALID/)
}

export async function withFixedDeadlineDiagnostics(
  profile: string,
  check: () => Promise<void>,
  writeDiagnostic: (text: string) => void,
): Promise<void> {
  try {
    await check()
  } catch (error) {
    try {
      const summary = await profilePhaseSummary(profile, 'run')
      writeDiagnostic(`Fixed wall-clock deadline phases: ${summary}\n`)
    } catch {
      // Preserve the original command or residue failure.
    }
    throw error
  }
}

/** Check live residue even after failure; only discard a successful fixture. */
export async function finishOperationalBaseline(input: {
  failures: readonly unknown[]
  temporary: string
  checkResidue: () => Promise<void>
  removeFixture: () => Promise<void>
}): Promise<void> {
  const failures = [...input.failures]
  try {
    await input.checkResidue()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length === 0) {
    try {
      await input.removeFixture()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length !== 0) {
    throw new AggregateError(
      failures,
      `Operational Baseline/1 failed. Retained fixture/evidence (possibly partial after removal failure): ${input.temporary}`,
    )
  }
}

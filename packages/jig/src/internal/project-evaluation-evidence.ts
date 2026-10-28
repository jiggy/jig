import type { JsonValue } from '../json.js'
import type {
  PrivateProjectEvaluationDeadlineLimit,
  PrivateProjectEvaluationFile,
  PrivateProjectEvaluationPhase,
  PrivateProjectEvaluationPhaseEvidence,
} from './project-evaluation-execution.js'

type Stream = PrivateProjectEvaluationPhaseEvidence['stdout']

export interface PrivateProjectEvaluationProcessEvidence {
  readonly invocation: readonly string[]
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stopReason: 'exited' | 'deadline' | 'cancelled' | null
  readonly durationMs: number | null
  readonly stdout: Stream | null
  readonly stderr: Stream | null
}

export interface PrivateProjectEvaluationFailureEvidence {
  readonly candidateDigest: string
  readonly recipeDigest: string
  readonly dependencyDigest: string
  readonly environmentDigest: string | null
  readonly phase: PrivateProjectEvaluationPhase | null
  readonly stage: 'setup' | 'preparation' | 'sealing' | 'admission' | 'collection' | 'settlement'
  readonly limit: PrivateProjectEvaluationDeadlineLimit | null
  readonly phases: readonly PrivateProjectEvaluationPhaseEvidence[]
  readonly process: PrivateProjectEvaluationProcessEvidence | null
  readonly files: readonly PrivateProjectEvaluationFile[] | null
  readonly cleanup: 'complete'
}

/** Snapshot already sanitized observations without changing successful evidence. */
export function privateProjectEvaluationFailureDetails(
  evidence: PrivateProjectEvaluationFailureEvidence,
): JsonValue {
  return Object.freeze({
    evaluation: Object.freeze({
      candidateDigest: evidence.candidateDigest,
      recipeDigest: evidence.recipeDigest,
      dependencyDigest: evidence.dependencyDigest,
      environmentDigest: evidence.environmentDigest,
      phase: evidence.phase,
      stage: evidence.stage,
      limit: evidence.limit,
      phases: Object.freeze(
        evidence.phases.map((phase) =>
          Object.freeze({
            phase: phase.phase,
            status: phase.status,
            invocation: Object.freeze([...phase.invocation]),
            exitCode: phase.exitCode,
            signal: phase.signal,
            stopReason: phase.stopReason,
            durationMs: phase.durationMs,
            stdout: stream(phase.stdout),
            stderr: stream(phase.stderr),
            files: files(phase.files),
          }),
        ),
      ),
      process:
        evidence.process === null
          ? null
          : Object.freeze({
              invocation: Object.freeze([...evidence.process.invocation]),
              exitCode: evidence.process.exitCode,
              signal: evidence.process.signal,
              stopReason: evidence.process.stopReason,
              durationMs: evidence.process.durationMs,
              stdout: stream(evidence.process.stdout),
              stderr: stream(evidence.process.stderr),
            }),
      files: evidence.files === null ? null : files(evidence.files),
      cleanup: evidence.cleanup,
    }),
  })
}

function files(value: readonly PrivateProjectEvaluationFile[]) {
  return Object.freeze(
    value.map((file) => Object.freeze({ path: file.path, bytes: file.bytes, digest: file.digest })),
  )
}

function stream(value: Stream): Stream
function stream(value: Stream | null): Stream | null
function stream(value: Stream | null): Stream | null {
  if (value === null) return null
  let bytes = 0
  let end = 0
  for (const scalar of value.text) {
    const width = Buffer.byteLength(scalar)
    if (bytes + width > 8 * 1024) break
    bytes += width
    end += scalar.length
  }
  return Object.freeze({
    text: value.text.slice(0, end),
    truncated: value.truncated || end < value.text.length,
  })
}

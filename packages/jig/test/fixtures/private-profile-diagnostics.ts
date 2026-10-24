import { open } from 'node:fs/promises'
import { normalizePrivateProfileFailure } from '../../src/internal/private-profile.js'

export function reviewCommandEnvironment(
  command: string | undefined,
  destination: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const selected = { ...environment }
  delete selected.JIG_PRIVATE_PROFILE_FILE
  if (command === 'review') selected.JIG_PRIVATE_PROFILE_FILE = destination
  return selected
}

export async function profilePhaseSummary(path: string, kind: 'review' | 'run'): Promise<string> {
  const phases = new Set([
    'installed-host-opening',
    'project-session-opening',
    ...(kind === 'review'
      ? [
          'project-planning',
          'project-evaluation-review',
          'author-configuration-evaluation',
          'author-support-verification',
          'author-envelope-startup',
          'author-execution-settlement',
          'dependency-workspace-capture',
          'dependency-preparation',
          'dependency-reuse',
        ]
      : [
          'root-submission-persistence',
          'linux-owner-state-initialization',
          'rootless-containment-startup',
          'flow-execution',
          'contained-effect-planning',
          'contained-effect-allocation',
          'contained-effect-sealing',
          'contained-effect-launch',
          'contained-effect-collection',
          'contained-effect-settlement',
          'operation-owner-settlement',
          'root-fence',
          'root-settlement',
          'root-package-release',
          'root-owner-release',
        ]),
    'project-session-close',
    'macos-guardian-preparation',
    'macos-guardian-admission',
  ])
  try {
    const file = await open(path, 'r')
    let text: string
    try {
      const bytes = Buffer.alloc(256 * 1024 + 1)
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
      if (bytesRead > 256 * 1024) return '{"status":"truncated","events":[]}'
      text = bytes.subarray(0, bytesRead).toString('utf8')
    } finally {
      await file.close()
    }
    const lines = text.trimEnd().split('\n')
    if (lines.length > 1026) return '{"status":"truncated","events":[]}'
    const events = []
    let truncated = false
    for (const line of lines) {
      const record = JSON.parse(line)
      if (record === null || typeof record !== 'object') return '{"status":"invalid","events":[]}'
      if (record.kind === 'failure') {
        const failure = normalizePrivateProfileFailure(record)
        if (failure === undefined) return '{"status":"invalid","events":[]}'
        events.push(failure)
        continue
      }
      if (record.kind === 'truncated') truncated = true
      if (!phases.has(record.phase)) continue
      if (
        !['start', 'end', 'instant'].includes(record.kind) ||
        !Number.isFinite(record.timeMs) ||
        record.timeMs < 0 ||
        record.timeMs > 86_400_000 ||
        (record.kind === 'end' && !['returned', 'failed'].includes(record.outcome))
      )
        return '{"status":"invalid","events":[]}'
      events.push({
        phase: record.phase,
        kind: record.kind,
        timeMs: record.timeMs,
        ...(record.kind === 'end' ? { outcome: record.outcome } : {}),
      })
    }
    // Keep the boundary, including failed ends, instead of an optimistic prefix.
    if (events.length > 40) truncated = true
    return JSON.stringify({
      status: truncated ? 'truncated' : 'captured',
      events: events.slice(-40),
    })
  } catch {
    // Optional trace observation must not replace the original command failure.
    return '{"status":"unavailable","events":[]}'
  }
}

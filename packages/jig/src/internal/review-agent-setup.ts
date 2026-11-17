import type { PrivateAgentSourceLocation } from '../project/agent-source-location.js'
import type { AcpGrant, NativeAcpClient } from '../project/grants.js'
import type { RunTargetIdentity } from '../project/package-project.js'

export type { PrivateAgentSourceLocation } from '../project/agent-source-location.js'

export interface PrivateAgentGrantRecipient {
  readonly binding: string
  readonly declaration: string
  readonly slot: string
}

export interface PrivateAgentReviewSelection extends PrivateAgentGrantRecipient {
  readonly sourceClient: NativeAcpClient | 'default'
  readonly effectiveClient: NativeAcpClient
  readonly source: PrivateAgentSourceLocation
}

export interface PrivateAgentReadinessIssue {
  readonly source: 'inline' | 'named'
  readonly location: PrivateAgentSourceLocation
  readonly declaration: string
  readonly slot: string
  readonly client: NativeAcpClient
  readonly sourceClient: NativeAcpClient | 'default'
  readonly override?: NativeAcpClient
  readonly policy: AcpGrant
  readonly code: string
  readonly rejectedOverride?: 'CODEX_PATH' | 'CLAUDE_PATH'
  readonly recipients: readonly PrivateAgentGrantRecipient[]
  readonly omittedRecipients: number
  readonly observedRefusals: number
  readonly alternatives: readonly NativeAcpClient[]
}

/** Private bounded observed facts, never a Plan result, source editor, or authority. */
export interface PrivateAgentReadinessReport {
  /** The CLI refusal decision survives omission of every presentation row. */
  readonly selectedAcpUnavailable: boolean
  readonly readyTargets?: number
  readonly unavailableTargets?: number
  readonly entrypoint?: {
    readonly target: RunTargetIdentity
    readonly state: 'ready' | 'unavailable'
  }
  readonly primaryIssue?: PrivateAgentReadinessIssue
  readonly observedIssues: number
  readonly observedPolicyGroups: number
  readonly uncheckedResources: number
  readonly complete: boolean
  readonly omittedPolicyGroups: number
  readonly issues: readonly PrivateAgentReadinessIssue[]
  readonly selections: readonly PrivateAgentReviewSelection[]
  readonly omittedSelections: number
}

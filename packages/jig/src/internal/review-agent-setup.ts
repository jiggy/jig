import type { AcpGrant } from '../project/grants.js'
import type { RunTargetIdentity } from '../project/package-project.js'

export interface PrivateAgentGrantRecipient {
  readonly binding: string
  readonly declaration: string
  readonly slot: string
}
export interface PrivateAgentReadinessGrant {
  readonly path: string
  readonly policy: AcpGrant
  readonly bytes: Uint8Array
  readonly recipients: readonly PrivateAgentGrantRecipient[]
}
/** Private authoring context, never a Plan result or Flow-visible value. */
export interface PrivateAgentReadinessReport {
  readonly projectIdentity: { readonly device: string; readonly inode: string }
  readonly readyTargets: number
  readonly unavailableTargets: number
  readonly entrypoint?: {
    readonly target: RunTargetIdentity
    readonly state: 'ready' | 'unavailable'
  }
  readonly complete: boolean
  readonly issues: readonly {
    readonly target: RunTargetIdentity
    readonly declaration: string
    readonly slot: string
    readonly client: AcpGrant['client']
    readonly code: string
    readonly grant?: PrivateAgentReadinessGrant
    readonly alternatives: readonly AcpGrant['client'][]
  }[]
}

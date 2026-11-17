import type { JsonValue } from '../../json.js'

export interface SourceSite {
  readonly path: string
  readonly line: number
  readonly column?: number
}

export interface BehaviorPackage {
  readonly entry: string
  readonly sources: ReadonlyMap<string, string>
  readonly reportingFiles?: ReadonlySet<string>
  readonly unavailable?: string
  readonly contractPath?: string
  readonly checkResult?: (result: JsonValue) => boolean
}

export interface BehaviorTarget {
  readonly id: string
  readonly implementation: string
  readonly settings: JsonValue
  readonly slots: ReadonlyMap<string, string>
  readonly outcomes: readonly string[]
  readonly attachments?: Readonly<Record<string, string>>
  readonly artifactResults?: readonly string[]
}

export interface BehaviorInput {
  readonly revision: string
  readonly focus: string | undefined
  readonly targets: readonly BehaviorTarget[]
  readonly visible: readonly string[]
  readonly packages: ReadonlyMap<string, BehaviorPackage>
}

export interface BehaviorAssumption {
  readonly kind: 'opaque-return' | 'contract-return' | 'call-failure'
  readonly site: SourceSite
  readonly slot: string
  readonly detail: string
}

export interface BehaviorGuard {
  readonly site: SourceSite
  readonly code: string
  readonly taken: boolean
  readonly unresolved: boolean
}

export interface BehaviorReturn {
  readonly outcome: string
  readonly fields: readonly (readonly [string, string])[]
  readonly artifacts: readonly string[]
}

export type BehaviorStep =
  | ({ readonly kind: 'condition' } & BehaviorGuard)
  | {
      readonly kind: 'call'
      readonly site: SourceSite
      readonly caller: string
      readonly slot: string
      readonly target: string
      readonly completion: 'source-return' | 'if-returned' | 'if-failed'
      readonly result: string
      readonly returned?: BehaviorReturn
      readonly assumptions?: readonly BehaviorAssumption[]
      readonly guards?: readonly BehaviorGuard[]
      readonly childPath?: number
    }
  | {
      readonly kind: 'effect'
      readonly owner: string
      readonly site: SourceSite
      readonly operation: string
      readonly detail: string
      readonly guards?: readonly BehaviorGuard[]
    }
  | { readonly kind: 'gap'; readonly site: SourceSite; readonly detail: string }
  | {
      readonly kind: 'end'
      readonly site: SourceSite
      readonly completion: 'return' | 'rejected' | 'throw' | 'unknown'
      readonly detail: string
      readonly returned?: BehaviorReturn
      readonly contractPath?: string
    }

export interface BehaviorChildPath {
  readonly input: string
  readonly steps: readonly BehaviorStep[]
}

export interface BehaviorReport {
  readonly unavailable?: string
  readonly revision: string
  readonly focus: string | undefined
  readonly inventory: readonly BehaviorTarget[]
  readonly childPaths: readonly BehaviorChildPath[]
  readonly scopes: readonly {
    readonly target: string
    readonly routes: readonly (readonly BehaviorStep[])[]
    readonly alternatives: readonly (readonly BehaviorStep[])[]
    readonly gaps: readonly (SourceSite & { readonly reason: string })[]
  }[]
}

export const BEHAVIOR_LIMITS = {
  packages: 128,
  filesPerPackage: 64,
  sourceBytes: 512 * 1024,
  fileBytes: 96 * 1024,
  steps: 18_000,
  depth: 20,
  variants: 32,
  scopes: 24,
  stepsPerRoute: 72,
  retainedChildPaths: 256,
  retainedChildSteps: 4_096,
} as const

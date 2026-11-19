import type { JsonValue } from '../../json.js'
import type { FlowImportBoundary } from '../flow-import-boundary.js'
import type { Value } from './values.js'

export interface SourceSite {
  readonly path: string
  readonly line: number
  readonly column?: number
  readonly identity?: string
}

export type ReportingCall = SourceSite & { readonly code: string }
export type ProgressFieldSource = ReportingCall & { readonly field: 'completed' | 'total' }

export function withoutReportingLocations(key: string, value: unknown): unknown {
  return key === 'reportingCall' || key === 'progressFields' ? undefined : value
}

export interface BehaviorPackage {
  readonly entry: string
  readonly sources: ReadonlyMap<string, string>
  readonly reportingFiles?: ReadonlySet<string>
  readonly unavailable?: string
  readonly contractPath?: string
  readonly acceptedInput?: Value
  readonly checkResult?: (result: JsonValue) => boolean
}

export interface BehaviorTarget {
  readonly id: string
  readonly implementation: string
  readonly settings: JsonValue
  readonly slots: ReadonlyMap<string, string>
  readonly requiredSlots?: readonly string[]
  readonly slotDeclarationPath?: string
  readonly outcomes: readonly string[]
  readonly attachments?: Readonly<Record<string, string>>
  readonly artifactResults?: readonly string[]
}

export interface BehaviorInput {
  readonly revision: string
  readonly focus: string | undefined
  readonly packagePath?: string
  readonly entrypoint?: string
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
  readonly validation?: true
  readonly readOperation?: true
  readonly enteringNumbers?: readonly (readonly [name: string, value: number])[]
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
      readonly representativeChild?: true
    }
  | {
      readonly kind: 'effect'
      readonly owner: string
      readonly site: SourceSite
      readonly operation: string
      readonly detail: string
      readonly guards?: readonly BehaviorGuard[]
      readonly reportingCall?: ReportingCall
      readonly progressFields?: readonly ProgressFieldSource[]
    }
  | { readonly kind: 'gap'; readonly site: SourceSite; readonly detail: string }
  | {
      readonly kind: 'repeat'
      readonly site: SourceSite
      readonly collection: string
      readonly count?: number
    }
  | {
      readonly kind: 'end'
      readonly site: SourceSite
      readonly completion: 'return' | 'rejected' | 'throw' | 'unknown'
      readonly detail: string
      readonly returned?: BehaviorReturn
      readonly contractPath?: string
    }

export function isFileOperation(
  step: BehaviorStep,
): step is Extract<BehaviorStep, { kind: 'effect' }> {
  return (
    step.kind === 'effect' &&
    ['open', 'stat', 'readFile', 'close', 'writeFile'].includes(step.operation)
  )
}

export interface BehaviorChildPath {
  readonly input: string
  readonly steps: readonly BehaviorStep[]
}

export interface AuthoredHandoff {
  readonly slot: string
  readonly target: string
  readonly site: SourceSite
  readonly intent?: string
  readonly guards: readonly BehaviorGuard[]
  readonly priorExits?: readonly AuthoredPriorExit[]
  readonly exitChecks: readonly {
    readonly site: SourceSite
    readonly code: string
    readonly taken: boolean
    readonly exit: 'return' | 'throw'
  }[]
}

export interface AuthoredPriorExit {
  readonly condition: SourceExpression
  readonly taken: boolean
  readonly statement: SourceExpression
}

interface SourceExpression {
  readonly code: string
  readonly site: SourceSite
}

export interface AuthoredDispatch extends SourceSite {
  readonly helper: string
  readonly declaration: SourceSite
  readonly request: string
  readonly arguments: readonly {
    readonly field: 'slot' | 'operationId' | 'intent' | 'input'
    readonly index: number
    readonly parameter: string
  }[]
}

export interface AuthoredCallSelection {
  readonly slot: string
  readonly site: SourceSite
  readonly dispatch?: AuthoredDispatch
  readonly guards: readonly BehaviorGuard[]
  readonly requestMetadata: readonly (SourceExpression & {
    readonly field: 'operationId' | 'intent'
  })[]
  readonly inputSite?: SourceSite
  readonly inputChoices: readonly (SourceExpression & { readonly field: string })[]
}

export interface RelatedCall {
  readonly caller: string
  readonly slot: string
  readonly target: string
}

export interface SlotSelection {
  readonly lookup: SourceExpression
  readonly table: SourceExpression
  readonly key: string
  readonly member: string
  readonly rows: readonly { readonly key: string; readonly slot: string }[]
  readonly origins: readonly {
    readonly value: SourceExpression
    readonly enclosing?: { readonly condition: SourceExpression; readonly taken: boolean }
    readonly producer?: SourceExpression
    readonly inputSlot?: { readonly name: string; readonly site: SourceSite }
    readonly guard?: { readonly condition: SourceExpression; readonly exit: SourceExpression }
  }[]
}

export type CallReference = { readonly site: SourceSite } & (
  | { readonly kind: 'literal'; readonly slot: string }
  | { readonly kind: 'computed'; readonly expression: string; readonly selection?: SlotSelection }
)

export interface BehaviorReport {
  readonly unavailable?: string
  readonly revision: string
  readonly focus: string | undefined
  readonly packagePath?: string
  readonly entrypoint?: string
  readonly inventory: readonly BehaviorTarget[]
  readonly childPaths: readonly BehaviorChildPath[]
  readonly importBoundary?: FlowImportBoundary & {
    readonly sourcePackage: string
    readonly targetPackage?: string
  }
  readonly scopes: readonly {
    readonly target: string
    readonly routes: readonly (readonly BehaviorStep[])[]
    readonly alternatives: readonly (readonly BehaviorStep[])[]
    readonly gaps: readonly (SourceSite & { readonly reason: string })[]
    readonly authoredHandoffs?: readonly AuthoredHandoff[]
    readonly authoredHandoffsOmitted?: number
    readonly callReferences?: readonly CallReference[]
    readonly callReferencesOmitted?: number
    readonly callSelections?: {
      readonly sites: readonly AuthoredCallSelection[]
      readonly omitted: number
      readonly related: ReadonlyMap<
        string,
        { readonly calls: readonly RelatedCall[]; readonly omitted: number }
      >
    }
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
  loopItems: 8,
  scopes: 24,
  stepsPerRoute: 72,
  retainedChildPaths: 256,
  retainedChildSteps: 4_096,
  authoredHandoffs: 24,
  focusedCallSelections: 6,
  focusedRelatedCalls: 6,
} as const

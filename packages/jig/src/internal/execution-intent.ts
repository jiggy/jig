import type { PrivateCapturedInput } from './input-capture.js'

/** Inert, trusted execution requirements. This is neither admission nor a public SPI. */
export interface PrivateExecutionIntent {
  readonly runId: string
  readonly limits: {
    readonly memoryBytes: number
    readonly pids: number
    readonly cpuQuotaMicros: number
    readonly cpuPeriodMicros: number
    readonly deadlineUnixMs: number
    readonly cancellationGraceMs: number
    readonly cleanupTimeoutMs?: number
  }
  readonly command: readonly [PrivateExecutionArgument, ...PrivateExecutionArgument[]]
  readonly projections: readonly {
    readonly source: string
    readonly destination: string
    readonly kind: 'file' | 'tree'
  }[]
  readonly environment?: Readonly<Record<string, string>>
  /** Trusted environment values containing projected paths (including encoded argv). */
  readonly relocateEnvironment?: boolean
  /** Bindings required when the host uses physical rather than virtual paths. */
  readonly relocatedEnvironment?: Readonly<Record<string, string>>
  readonly network?: 'isolated' | 'inherited'
  readonly nestedUserNamespaces?: boolean
  readonly capturedInputs?: readonly {
    readonly input: PrivateCapturedInput
    readonly destination: string
  }[]
  readonly inputDirectories?: readonly string[]
  readonly output?: boolean
  readonly storageBytes: number
  readonly maxOutputBytes: number
  /** No writable storage is needed by this finite read-only worker. */
  readonly readOnlyCwd?: string
}

export function privateExecutionFileProjections(
  files: readonly { readonly source: string; readonly destination: string }[],
): PrivateExecutionIntent['projections'] {
  return files.map((file) => ({ ...file, kind: 'file' as const }))
}

/** Only explicit path arguments are relocated; arbitrary payload text stays literal. */
export type PrivateExecutionArgument = string | { readonly path: string }
export function privateExecutionPath(path: string): PrivateExecutionArgument {
  return { path }
}

export const PRIVATE_OUTPUT_PATH = '/jig-output'
export const PRIVATE_OUTPUT_BYTES = 16 * 1024 * 1024

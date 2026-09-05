import { RunSession } from './session.js'
import { stdioTransport } from './transport.js'
import type { RunHandler } from './types.js'

export type {
  Attachment,
  AttachmentAccess,
  CallOptions,
  EffectCall,
  FlowCall,
  JsonObject,
  JsonScalar,
  JsonValue,
  OperationErrorCode,
  RunContext,
  RunHandler,
  RunResult,
} from './types.js'
export {
  EffectError,
  OperationError,
} from './types.js'

/** Handle exactly one FLOW Run/1 root request over protocol stdio. */
export async function handle(handler: RunHandler): Promise<void> {
  const transport = stdioTransport()
  redirectApplicationConsole()
  await new RunSession(transport, handler).run()
}

interface ConsoleWithConstructor extends Console {
  readonly Console?: new (stdout: unknown, stderr?: unknown) => Console
}

interface ProcessWithStderr {
  readonly stderr?: unknown
}

/**
 * Keep ordinary application logging away from protocol stdout.
 *
 * Raw descriptor writes remain the application's responsibility. This only
 * changes the language-level console after `handle()` assumes Run/1 ownership.
 */
function redirectApplicationConsole(): void {
  const current = globalThis.console as ConsoleWithConstructor
  const processLike = (globalThis as { process?: ProcessWithStderr }).process
  if (current.Console !== undefined && processLike?.stderr !== undefined) {
    ;(globalThis as { console: Console }).console = new current.Console(
      processLike.stderr,
      processLike.stderr,
    )
    return
  }

  // A standards-oriented runtime may not expose Node's Console constructor.
  // Its error console is the portable diagnostic fallback for the three
  // ordinary stdout logging methods.
  const diagnostic = current.error.bind(current)
  current.log = diagnostic
  current.info = diagnostic
  current.debug = diagnostic
}

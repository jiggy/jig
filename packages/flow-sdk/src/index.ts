import { RunSession } from "./session.ts";
import { stdioTransport } from "./transport.ts";
import type { RunHandler } from "./types.ts";

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
} from "./types.ts";
export {
  EffectError,
  OperationError,
} from "./types.ts";

/** Serve exactly one FLOW Run/1 root request over protocol stdio. */
export async function serve(handler: RunHandler): Promise<void> {
  await new RunSession(stdioTransport(), handler).run();
}

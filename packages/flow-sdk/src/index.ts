import { RunSession } from "./session.js";
import { stdioTransport } from "./transport.js";
import type { RunHandler } from "./types.js";

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
} from "./types.js";
export {
  EffectError,
  OperationError,
} from "./types.js";

/** Serve exactly one FLOW Run/1 root request over protocol stdio. */
export async function serve(handler: RunHandler): Promise<void> {
  await new RunSession(stdioTransport(), handler).run();
}

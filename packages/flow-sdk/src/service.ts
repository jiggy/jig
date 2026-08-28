import { ServiceSession } from "./service-session.js";
import { stdioTransport } from "./transport.js";
import type { ServiceDefinition } from "./types.js";

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
  RunResult,
  ServiceDefinition,
  ServiceExportHandler,
  ServiceInvocationContext,
  ServiceMountContext,
  ServiceMountHandler,
  ServiceOwnerContext,
} from "./types.js";
export {
  EffectError,
  OperationError,
  ServiceError,
} from "./types.js";

/** Serve exactly one FLOW Service/1 Mount over protocol stdio. */
export async function serveService(definition: ServiceDefinition): Promise<void> {
  await new ServiceSession(stdioTransport(), definition).run();
}

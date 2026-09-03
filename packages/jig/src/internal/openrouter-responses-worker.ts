import { requestPrivateOpenRouterResponse } from "./openrouter-responses-client.js";
import {
  decodePrivateOpenRouterResponsesRequest,
  encodePrivateOpenRouterResponsesFailure,
  encodePrivateOpenRouterResponsesSuccess,
  PrivateOpenRouterResponsesError,
  PRIVATE_OPENROUTER_RESPONSES_REQUEST_BYTES,
  type PrivateOpenRouterResponsesErrorCode,
} from "./openrouter-responses-protocol.js";

await main();

async function main(): Promise<void> {
  let output: Uint8Array;
  try {
    const input = await readBoundedInput(PRIVATE_OPENROUTER_RESPONSES_REQUEST_BYTES);
    const request = decodePrivateOpenRouterResponsesRequest(input);
    const value = await requestPrivateOpenRouterResponse(request, {
      apiKey: request.apiKey,
    });
    output = encodePrivateOpenRouterResponsesSuccess(value);
  } catch (error) {
    const failure = safeFailure(error);
    output = encodePrivateOpenRouterResponsesFailure(failure.code, failure.message);
  }
  try {
    await writeOutput(output);
  } catch {
    process.exitCode = 1;
  }
}

async function readBoundedInput(maximum: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const raw of process.stdin) {
    const chunk = typeof raw === "string"
      ? new TextEncoder().encode(raw)
      : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    total += chunk.byteLength;
    if (total > maximum) {
      throw new PrivateOpenRouterResponsesError(
        "AGENT_PROVIDER_PROTOCOL",
        "OpenRouter Responses worker request exceeds its byte bound",
      );
    }
    chunks.push(chunk.slice());
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function safeFailure(error: unknown): {
  readonly code: PrivateOpenRouterResponsesErrorCode;
  readonly message: string;
} {
  if (error instanceof PrivateOpenRouterResponsesError) {
    return Object.freeze({ code: error.code, message: error.message });
  }
  return Object.freeze({
    code: "AGENT_PROVIDER_UNAVAILABLE",
    message: "OpenRouter Responses worker failed",
  });
}

function writeOutput(bytes: Uint8Array): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(bytes, (error) => {
      if (error === null || error === undefined) resolve();
      else reject(error);
    });
  });
}

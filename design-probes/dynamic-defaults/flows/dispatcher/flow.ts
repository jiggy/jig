#!/usr/bin/env bun

// DESIGN PROBE ONLY: complete pseudocode against the future portable SDK.
import {
  type JsonValue,
  type RunResult,
  serveRun,
} from "@flowmd/sdk";

interface DispatchInput {
  readonly intent: string;
  readonly text: string;
}

const transformedValue = (value: JsonValue): string | undefined => {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }

  const candidate = (value as { readonly [name: string]: JsonValue }).value;
  return typeof candidate === "string" ? candidate : undefined;
};

serveRun<DispatchInput>(async (run): Promise<RunResult> => {
  const child = await run.flows.call({
    operationId: "delegate-text",
    slot: "delegate",
    intent: run.input.intent,
    input: { text: run.input.text },
  });

  const value = child.outcome === "done"
    ? transformedValue(child.output)
    : undefined;

  return value === undefined
    ? { outcome: "blocked", output: {} }
    : { outcome: "done", output: { value } };
});

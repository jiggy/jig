#!/usr/bin/env bun

// DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
import { type JsonValue, serve } from "@flow/run";

interface SearchInput {
  readonly query: string;
  readonly limit: number;
}

serve<SearchInput>(async run => {
  const result = await run.effects.call<JsonValue>({
    operationId: "search-index",
    slot: "index",
    method: "search",
    input: run.input as unknown as JsonValue,
  });
  return { outcome: "done", output: result };
});

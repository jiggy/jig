#!/usr/bin/env bun

// DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
import { type JsonValue, serveRun } from "@flowmd/sdk";

interface SearchInput {
  readonly query: string;
  readonly limit: number;
}

serveRun<SearchInput>(async run => {
  const result = await run.effects.call<JsonValue>({
    operationId: "search-index",
    slot: "index",
    method: "search",
    input: run.input as unknown as JsonValue,
  });
  return { outcome: "done", output: result };
});

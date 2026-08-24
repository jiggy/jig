#!/usr/bin/env deno

// DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
import { serveRun } from "@flowmd/sdk";

interface SummaryInput {
  readonly label: string;
  readonly words: number;
}

interface SummarySettings {
  readonly style: "plain" | "compact";
}

serveRun<SummaryInput, SummarySettings>(async ({ input, settings }) => {
  const text = settings.style === "compact"
    ? `${input.label}:${input.words}`
    : `${input.label}: ${input.words} words`;

  return {
    outcome: "done",
    output: { text },
  };
});

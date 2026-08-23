#!/usr/bin/env deno

// DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
import { serve } from "@flow/run";

interface SummaryInput {
  readonly label: string;
  readonly words: number;
}

interface SummarySettings {
  readonly style: "plain" | "compact";
}

serve<SummaryInput, SummarySettings>(async ({ input, settings }) => {
  const text = settings.style === "compact"
    ? `${input.label}:${input.words}`
    : `${input.label}: ${input.words} words`;

  return {
    outcome: "done",
    output: { text },
  };
});

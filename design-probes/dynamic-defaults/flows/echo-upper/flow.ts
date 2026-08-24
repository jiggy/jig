#!/usr/bin/env bun

// DESIGN PROBE ONLY: complete pseudocode against the future portable SDK.
import { serveRun } from "@flowmd/sdk";

interface TextInput {
  readonly text: string;
}

serveRun<TextInput>(run => ({
  outcome: "done",
  output: { value: run.input.text.toUpperCase() },
}));

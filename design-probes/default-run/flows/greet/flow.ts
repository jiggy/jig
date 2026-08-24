#!/usr/bin/env bun

// DESIGN PROBE ONLY: complete pseudocode against the future portable SDK.
import { serveRun } from "@flowmd/sdk";

interface GreetInput {
  readonly name: string;
}

serveRun<GreetInput>(run => ({
  outcome: "done",
  output: {
    greeting: `Hello, ${run.input.name}!`,
  },
}));

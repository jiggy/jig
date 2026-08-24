import { serve } from "../src/index.ts";

await serve(async (run) => ({
  outcome: "done",
  output: {
    input: run.input,
    scratch: run.scratch,
  },
}));

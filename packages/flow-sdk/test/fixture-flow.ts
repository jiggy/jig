import { handle } from "../src/index.ts";

await handle(async (run) => {
  console.log("handler log");
  console.info("handler info");
  console.debug("handler debug");
  return {
    outcome: "done",
    output: {
      input: run.input,
      scratch: run.scratch,
    },
  };
});

console.log("after handle");

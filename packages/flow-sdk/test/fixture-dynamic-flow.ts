import { handle } from "../src/index.ts";

await handle(async (run) => {
  const { runFlow } = await import("./fixture-top-level-logger.ts");
  return runFlow(run);
});

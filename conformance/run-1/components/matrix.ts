import { serve } from "../../../packages/flow-sdk/src/index";

await serve(async (run) => {
  const input = run.input as { case?: unknown };
  if (input.case !== "fanout-65") {
    return { outcome: "done", output: null };
  }

  const calls = Array.from({ length: 65 }, (_, index) =>
    run.callEffect({
      operationId: `fanout:${index + 1}`,
      slot: "sink",
      method: "write",
      input: { index },
    }),
  );
  await Promise.allSettled(calls);

  return { outcome: "done", output: { settled: calls.length } };
});

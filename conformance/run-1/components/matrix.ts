import { OperationError, serve } from "../../../packages/flow-sdk/src/index";

await serve(async (run) => {
  const input = run.input as { case?: unknown };
  switch (input.case) {
    case "fanout-65": {
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
    }
    case "operation-identity": {
      const call = () =>
        run.callEffect({
          operationId: "shared:1",
          slot: "sink",
          method: "write",
          input: { value: "same" },
        });
      const [first, second] = await Promise.all([call(), call()]);
      const replay = await call();
      let conflict: string | null = null;
      try {
        await run.callEffect({
          operationId: "shared:1",
          slot: "sink",
          method: "write",
          input: { value: "different" },
        });
      } catch (error) {
        if (!(error instanceof OperationError)) throw error;
        conflict = error.code;
      }
      return { outcome: "done", output: { first, second, replay, conflict } };
    }
    case "one-flow": {
      const child = await run.callFlow({
        operationId: "child:1",
        slot: "child",
        input: null,
      });
      return { outcome: "done", output: child };
    }
    case "two-effects": {
      const first = await run.callEffect({
        operationId: "first:1",
        slot: "sink",
        method: "write",
        input: { sequence: 1 },
      });
      const second = await run.callEffect({
        operationId: "second:1",
        slot: "sink",
        method: "write",
        input: { sequence: 2 },
      });
      return { outcome: "done", output: { first, second } };
    }
    default:
      return { outcome: "done", output: null };
  }
});

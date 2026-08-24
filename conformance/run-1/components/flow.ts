import { EffectError, serve } from "../../../packages/flow-sdk/src/index";

await serve(async (run) => {
  const researchPromise = run.callFlow({
    operationId: "research:1",
    slot: "research",
    intent: "Find a useful comparison target.",
    input: run.input,
  });

  const storedPromise = run.callEffect({
    operationId: "store:1",
    slot: "artifacts",
    method: "write",
    input: { source: "research" },
  });

  const [research, stored] = await Promise.all([researchPromise, storedPromise]);
  let missing: string | null = null;

  try {
    await run.callEffect({
      operationId: "missing:1",
      slot: "artifacts",
      method: "read",
      input: { uri: "artifact://missing" },
    });
  } catch (error) {
    if (!(error instanceof EffectError)) throw error;
    missing = error.errorName;
  }

  return {
    outcome: "done",
    output: { research, stored, missing },
  };
});

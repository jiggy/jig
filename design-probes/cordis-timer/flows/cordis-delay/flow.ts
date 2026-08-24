#!/usr/bin/env bun

// DESIGN PROBE ONLY: real Cordis APIs behind the future FLOW SDK.
import { Context } from "cordis";
import Timer from "@cordisjs/plugin-timer";
import { serveService, type JsonValue } from "@flowmd/sdk";

interface DelayInput {
  readonly delayMs: number;
}

const wait = (
  root: Context,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> => {
  const cancelled = () =>
    signal.reason ?? new Error("delay invocation cancelled");
  if (signal.aborted) return Promise.reject(cancelled());

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cancel();
      reject(cancelled());
    };
    const cancel = root.timeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
};

serveService(async () => {
  const root = new Context();
  await root.plugin(Timer);

  return {
    exports: {
      delay: {
        async wait(input: JsonValue, invocation) {
          const { delayMs } = input as unknown as DelayInput;
          await wait(root, delayMs, invocation.signal);
          return { completed: true };
        },
      },
    },
    dispose: () => root.fiber.dispose(),
  };
});

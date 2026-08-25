import {
  ServiceError,
  serveService,
  type ServiceDefinition,
} from "../../../packages/flow-sdk/src/index.ts";

const service: ServiceDefinition = {
  exports: {
    sessions: async (context) => {
      if (context.method === "echo") return context.input;
      if (context.method === "missing") throw new ServiceError("not-found", context.input);
      if (context.method === "dependency") {
        return await context.callEffect({
          operationId: "storage:1",
          slot: "storage",
          method: "read",
          input: context.input,
        });
      }
      if (context.method === "slow") {
        await new Promise<void>((resolve) => {
          context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        return "caught-cancellation";
      }
      return null;
    },
  },
  async mount(context) {
    if (context.settings.initialize === true) {
      await context.callEffect({
        operationId: "initialize:1",
        slot: "storage",
        method: "open",
        input: null,
      });
    }
    await context.ready();
    await context.cancelled;
  },
};

await serveService(service);

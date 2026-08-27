import {
  OperationError,
  ServiceError,
  serveService,
  type ServiceDefinition,
} from "../../../packages/flow-sdk/src/index.ts";

const service: ServiceDefinition = {
  exports: process.env.FLOWMD_TEST_EMPTY_SERVICE === "1" ? {} : {
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
      if (context.method === "detached") {
        void context.callEffect({
          operationId: "detached:1",
          slot: "storage",
          method: "read",
          input: context.input,
        });
        return "must-not-succeed";
      }
      if (context.method === "fanout") {
        return await Promise.all(Array.from({ length: 65 }, async (_, index) => {
          try {
            await context.callEffect({
              operationId: `fanout:${index}`,
              slot: "storage",
              method: "read",
              input: index,
            });
            return "ok";
          } catch (error) {
            return error instanceof OperationError ? error.code : "unexpected";
          }
        }));
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
    if (context.settings.detachedMount === true) {
      void context.callEffect({
        operationId: "mount-detached:1",
        slot: "storage",
        method: "read",
        input: null,
      });
      return;
    }
    await context.cancelled;
  },
};

await serveService(service);

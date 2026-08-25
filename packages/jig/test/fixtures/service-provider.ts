import {
  ServiceError,
  serveService,
  type ServiceDefinition,
} from "../../../flow-sdk/src/index.ts";

const service: ServiceDefinition = {
  exports: {
    sessions: async (context) => {
      if (context.method === "read") return { input: context.input };
      if (context.method === "missing") throw new ServiceError("not-found", context.input);
      if (context.method === "dependency") {
        return await context.callEffect({
          operationId: "storage:1",
          slot: "storage",
          method: "read",
          input: context.input,
        });
      }
      return null;
    },
  },
  async mount(context) {
    await context.ready();
    await context.cancelled;
  },
};

await serveService(service);

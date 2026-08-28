import {
  ServiceError,
  serveService,
  type ServiceDefinition,
} from "../../../flow-sdk/src/service.ts";

let value = 0;

const service: ServiceDefinition = {
  exports: {
    counter: async (context) => {
      if (context.method !== "next") {
        throw new ServiceError("not-found", { method: context.method });
      }
      value += 1;
      return value;
    },
  },
  async mount(context) {
    await context.ready();
    await context.cancelled;
  },
};

await serveService(service);

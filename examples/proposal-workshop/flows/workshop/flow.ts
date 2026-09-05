import { handle } from "@jigging/flow";

await handle(async (run) => {
  const { workshop } = await import("./workshop.ts");
  return workshop(run);
});

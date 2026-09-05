import { handle } from "@jigging/flow";

await handle(async (run) => {
  const { draft } = await import("./draft.ts");
  return draft(run);
});

import { handle } from "@jigging/flow";

await handle(async (run) => {
  const { review } = await import("./review.ts");
  return review(run);
});

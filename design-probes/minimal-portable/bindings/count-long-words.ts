// DESIGN PROBE ONLY: one complete reusable configuration.
import { bind } from "@jigging/jig";

export default bind({
  use: "./flows/count-text",
  settings: {
    minWordLength: 2,
  },
});

// DESIGN PROBE ONLY: one complete reusable configuration.
import { bind } from "jig";

export default bind({
  use: "./flows/count-text",
  settings: {
    minWordLength: 2,
  },
});

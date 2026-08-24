// DESIGN PROBE ONLY: a second configuration does not create a runtime profile.
import { bind } from "@jigging/jig";

export default bind({
  use: "./flows/render-summary",
  settings: {
    style: "compact",
  },
});

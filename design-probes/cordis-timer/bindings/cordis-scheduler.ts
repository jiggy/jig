import { bind, bindingRef } from "jig";

export default bind({
  use: "./flows/cordis-scheduler",
  settings: { maxTimerRecords: 128 },
  slots: { journal: bindingRef("journal") },
});

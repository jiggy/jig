import { openPrivateProjectSession } from "../../src/internal/project-session-controller.js";
import { openPrivateInstalledBunHost } from "../../src/internal/installed-bun-host.js";
import { installedBunLocation } from "./installed-bun-location.js";

const [projectRoot, submissionId, mode = "direct"] = process.argv.slice(2);
if (projectRoot === undefined || submissionId === undefined) {
  throw new Error("usage: project-session-runner <project-root> <submission-id> [direct|child]");
}
if (mode !== "direct" && mode !== "child") throw new Error("invalid project-session runner mode");

const session = await openPrivateProjectSession({
  directory: projectRoot,
  host: await openPrivateInstalledBunHost(installedBunLocation),
});
const receipt = await session.rootAdministration.startRun({
  submissionId,
  target: mode === "child"
    ? { kind: "binding", id: "ticket-router" }
    : { kind: "flow", path: "flows/worker" },
  input: mode === "child"
    ? { scenario: "slow", kind: "bug", ticket: submissionId }
    : { ticket: submissionId, delayMs: 20_000 },
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
await Bun.sleep(3_600_000);

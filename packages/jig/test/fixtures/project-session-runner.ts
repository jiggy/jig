import { openPrivateProjectSession } from "../../src/internal/project-session-controller.js";
import { openPrivateInstalledBunHost } from "../../src/internal/installed-bun-host.js";

const [projectRoot, submissionId] = process.argv.slice(2);
if (projectRoot === undefined || submissionId === undefined) {
  throw new Error("usage: project-session-runner <project-root> <submission-id>");
}

const session = await openPrivateProjectSession({
  directory: projectRoot,
  host: await openPrivateInstalledBunHost(),
});
const receipt = await session.rootAdministration.startRun({
  submissionId,
  target: { kind: "flow", path: "flows/worker" },
  input: { ticket: submissionId, delayMs: 20_000 },
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
await Bun.sleep(3_600_000);

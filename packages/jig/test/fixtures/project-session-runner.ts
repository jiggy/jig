import { openPrivateProjectSession } from "../../src/internal/project-session-controller.js";
import { openRootlessBunProofHost } from "../../scripts/private-rootless-proof-host.js";

const [projectRoot, submissionId] = process.argv.slice(2);
if (projectRoot === undefined || submissionId === undefined) {
  throw new Error("usage: project-session-runner <project-root> <submission-id>");
}

const session = await openPrivateProjectSession({
  directory: projectRoot,
  host: await openRootlessBunProofHost(),
});
const receipt = await session.rootAdministration.startRun({
  submissionId,
  target: { kind: "flow", path: "flows/worker" },
  input: { ticket: submissionId, delayMs: 20_000 },
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
await Bun.sleep(3_600_000);

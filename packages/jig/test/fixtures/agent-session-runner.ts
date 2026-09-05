import { join } from "node:path";

import { openPrivateInstalledBunHost } from "../../src/internal/installed-bun-host.js";
import { openPrivateProjectSession } from "../../src/internal/project-session-controller.js";

const [projectRoot, releaseRoot, executablePath, submissionId, mode] = process.argv.slice(2);
if (projectRoot === undefined || releaseRoot === undefined ||
    executablePath === undefined || submissionId === undefined) {
  throw new Error(
    "usage: agent-session-runner <project-root> <release-root> <bun-path> <submission-id> [root|specialist]",
  );
}

const session = await openPrivateProjectSession({
  directory: projectRoot,
  host: await openPrivateInstalledBunHost({
    releaseRoot,
    executablePath,
    installedCliPath: join(releaseRoot, "libexec", "installed-cli.js"),
  }),
});
const receipt = await session.rootAdministration.startRun({
  submissionId,
  target: mode === "specialist"
    ? { kind: "binding", id: "parent" }
    : { kind: "flow", path: "flows/router" },
  input: { scenario: "recovery" },
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
await Bun.sleep(3_600_000);

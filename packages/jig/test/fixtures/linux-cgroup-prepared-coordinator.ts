import { chmod, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxCgroupBackend,
} from "../../src/internal/linux-cgroup-backend.js";

const scope = process.env.JIG_TEST_SCOPE;
const bash = process.env.JIG_TEST_BASH;
if (scope === undefined || bash === undefined) throw new Error("missing coordinator fixture environment");
await realpath(scope);
await readFile(bash);

const backend = new PrivateLinuxCgroupBackend({
  cgroupScope: scope,
  sudoPath: "/agent-sudo/bin/sudo",
  subreaperPath: "/run/podman-init",
  mknodPath: "/bin/mknod",
  bunPath: "/bin/bun",
  bubblewrapPath: "/usr/bin/bwrap",
  bashPath: bash,
  payloadUid: 1000,
  payloadGid: 100,
});
const ownerParent = await mkdtemp(join(tmpdir(), "jig-prepared-owner-"));
await chmod(ownerParent, 0o700);
const allocation = await planPrivateLinuxOwnerStateAllocation({
  parent: ownerParent,
  name: "prepared-coordinator-failure",
});
const sealed = await backend.seal({
  runId: "prepared-coordinator-failure",
  limits: {
    memoryBytes: 64 * 1024 * 1024,
    pids: 16,
    cpuQuotaMicros: 10_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs: Date.now() + 30_000,
    cancellationGraceMs: 1_000,
    cleanupTimeoutMs: 5_000,
  },
  readOnlyMounts: [{ source: "/nix/store", destination: "/nix/store" }],
  command: [bash, "-c", "printf package-must-not-start"],
}, allocation);
void sealed.admit(undefined, async (prepared) => {
  console.log(JSON.stringify({ allocation, ownerParent, prepared }));
  await new Promise(() => undefined);
}).catch(() => undefined);
await new Promise(() => undefined);

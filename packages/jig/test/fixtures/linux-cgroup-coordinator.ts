import { readFile, realpath } from "node:fs/promises";

import { PrivateLinuxCgroupBackend } from "../../src/internal/linux-cgroup-backend.js";

const scope = process.env.JIG_TEST_SCOPE;
const bash = process.env.JIG_TEST_BASH;
if (scope === undefined || bash === undefined) throw new Error("missing coordinator fixture environment");
await realpath(scope);
await readFile(bash);

const backend = new PrivateLinuxCgroupBackend({
  cgroupScope: scope,
  sudoPath: "/agent-sudo/bin/sudo",
  bunPath: "/bin/bun",
  bubblewrapPath: "/usr/bin/bwrap",
  payloadUid: 1000,
  payloadGid: 100,
});
const component = await backend.launch({
  runId: "coordinator-failure",
  limits: {
    memoryBytes: 64 * 1024 * 1024,
    pids: 16,
    cpuQuotaMicros: 10_000,
    cpuPeriodMicros: 100_000,
    wallClockMs: 30_000,
    cleanupTimeoutMs: 5_000,
  },
  readOnlyMounts: [{ source: "/nix/store", destination: "/nix/store" }],
  command: [bash, "-c", "while :; do :; done"],
});
void (async () => { for await (const _ of component.stdout) {} })();
void (async () => { for await (const _ of component.stderr) {} })();
console.log(JSON.stringify({ parentCgroup: component.cgroup.parentCgroup }));
await new Promise(() => undefined);

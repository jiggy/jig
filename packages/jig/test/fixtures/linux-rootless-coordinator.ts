import { readFile } from "node:fs/promises";

import { PrivateRootlessLinuxBackend } from "../../src/internal/linux-rootless-run.js";

interface Configuration {
  readonly delegatedCgroup: string;
  readonly bunPath: string;
  readonly bubblewrapPath: string;
  readonly mounts: readonly { readonly source: string; readonly destination: string }[];
  readonly fixture: string;
  readonly uid: number;
  readonly gid: number;
}

const path = process.argv[2];
if (path === undefined) throw new Error("missing rootless coordinator configuration");
const configuration = JSON.parse(await readFile(path, "utf8")) as Configuration;
const backend = new PrivateRootlessLinuxBackend({
  delegatedCgroup: configuration.delegatedCgroup,
  bunPath: configuration.bunPath,
  bubblewrapPath: configuration.bubblewrapPath,
  payloadUid: configuration.uid,
  payloadGid: configuration.gid,
});
const component = await backend.launch({
  runId: "coordinator-loss",
  limits: {
    memoryBytes: 256 * 1024 * 1024,
    pids: 64,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs: Date.now() + 30_000,
  },
  readOnlyMounts: [...configuration.mounts, { source: configuration.fixture, destination: "/package" }],
  command: [configuration.bunPath, "--no-env-file", "--no-install", "--config=/dev/null", "/package/flow.ts"],
});

console.log(JSON.stringify({ cgroup: component.cgroup }));
await new Promise(() => {});

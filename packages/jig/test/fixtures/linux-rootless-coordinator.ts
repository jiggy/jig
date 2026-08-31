import { readFile } from "node:fs/promises";

import {
  planPrivateLinuxOwnerStateAllocation,
  PrivateLinuxCgroupBackend,
} from "../../src/internal/linux-rootless-backend.js";

interface Configuration {
  readonly delegatedCgroup: string;
  readonly bunPath: string;
  readonly bunHostLibraryPath: string;
  readonly bubblewrapPath: string;
  readonly mounts: readonly { readonly source: string; readonly destination: string }[];
  readonly fixture: string;
  readonly ownerStateParent: string;
  readonly uid: number;
  readonly gid: number;
}

const path = process.argv[2];
if (path === undefined) throw new Error("missing rootless coordinator configuration");
const configuration = JSON.parse(await readFile(path, "utf8")) as Configuration;
const backend = new PrivateLinuxCgroupBackend({
  bunPath: configuration.bunPath,
  bunHostLibraryPath: configuration.bunHostLibraryPath,
});
const plan = {
  runId: "coordinator-loss",
  limits: {
    memoryBytes: 256 * 1024 * 1024,
    pids: 64,
    cpuQuotaMicros: 50_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs: Date.now() + 30_000,
    cancellationGraceMs: 250,
  },
  readOnlyMounts: [...configuration.mounts, { source: configuration.fixture, destination: "/package" }],
  command: ["/jig-runtime/jig", "--no-env-file", "--no-install", "--config=/dev/null", "/package/flow.ts"],
};
const allocation = await planPrivateLinuxOwnerStateAllocation({
  parent: configuration.ownerStateParent,
  name: "coordinator-loss",
});
const owner = await backend.seal(plan, allocation);
const component = await owner.admit();

console.log(JSON.stringify({ cgroup: component.cgroup.runCgroup, owner: component.owner }));
await new Promise(() => {});

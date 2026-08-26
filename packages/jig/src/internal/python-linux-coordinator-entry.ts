import {
  PrivateLinuxCgroupBackend,
  type PrivateLinuxCgroupBackendOptions,
} from "./linux-cgroup-backend.js";
import {
  executePrivatePythonExactRun,
  planPrivatePythonExactRunIntent,
} from "./python-nix-run.js";
import { observePrivatePythonNixRuntime } from "./python-nix-runtime.js";

export const privateHostExtensionAbi = "jig-private-python-linux-coordinator/1" as const;

type BundledBackendOptions = Omit<PrivateLinuxCgroupBackendOptions, "helperPath"> & {
  readonly helperPath: string;
};

export function createBackend(
  options: BundledBackendOptions,
): PrivateLinuxCgroupBackend {
  if (options === null || typeof options !== "object" || Array.isArray(options) ||
      typeof options.helperPath !== "string") {
    throw new TypeError("bundled Linux Backend requires an exact helperPath");
  }
  return new PrivateLinuxCgroupBackend(options);
}

export const execute = executePrivatePythonExactRun;
export const observeRuntime = observePrivatePythonNixRuntime;
export const plan = planPrivatePythonExactRunIntent;

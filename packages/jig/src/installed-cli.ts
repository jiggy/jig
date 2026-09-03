import { realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  main,
  privateCliCommandLifetimeMs,
  privateCliRequiresHost,
  type PrivateCliCommandHost,
} from "./cli.js";
import { openPrivateInstalledBunHost } from "./internal/installed-bun-host.js";
import {
  acquireOrReexecutePrivateRootlessLinux,
} from "./internal/linux-rootless-delegation.js";
import { PrivateRootlessLinuxAcquisitionError } from "./internal/linux-rootless-acquisition.js";
import { openPrivateProjectSession } from "./internal/project-session-controller.js";

interface InstalledCliOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

const BUN_POLICY = Object.freeze([
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
] as const);
const installedCliPath = await realpath(fileURLToPath(import.meta.url));
const releaseRoot = dirname(dirname(installedCliPath));
const executablePath = await realpath(process.execPath);
if (process.argv[0] !== executablePath || process.argv[1] !== installedCliPath ||
    await realpath("/proc/self/exe") !== executablePath ||
    process.execArgv.length !== BUN_POLICY.length ||
    process.execArgv.some((value, index) => value !== BUN_POLICY[index])) {
  throw new Error("the installed Jig command has an invalid startup posture");
}

/** The one installed alpha entrypoint. It is bundled into `libexec`. */
async function runPrivateInstalledCli(
  arguments_: readonly string[] = process.argv.slice(2),
  signal?: AbortSignal,
): Promise<InstalledCliOutcome> {
  if (!privateCliRequiresHost(arguments_)) {
    return exit(await main(arguments_, signal === undefined ? {} : { signal }));
  }

  try {
    const delegation = await acquireOrReexecutePrivateRootlessLinux({
      commandLifetimeMs: privateCliCommandLifetimeMs(arguments_),
    });
    if (delegation.kind === "private-rootless-linux-reexecuted/1") return delegation;

    const installedHost = await openPrivateInstalledBunHost({
      releaseRoot: await realpath(releaseRoot),
      executablePath,
      installedCliPath,
    });
    const host: PrivateCliCommandHost = Object.freeze({
      acquire: (
        project: string,
        options?: { readonly runTimeoutMs?: number },
      ) => openPrivateProjectSession({
        directory: project,
        host: options?.runTimeoutMs === undefined
          ? installedHost
          : Object.freeze({ ...installedHost, runTimeoutMs: options.runTimeoutMs }),
      }),
    });
    return exit(await main(arguments_, {
      host,
      ...(signal === undefined ? {} : { signal }),
    }));
  } catch (error) {
    if (error instanceof PrivateRootlessLinuxAcquisitionError) {
      process.stderr.write("SANDBOX_UNAVAILABLE: the required rootless Linux sandbox is unavailable\n");
    } else {
      process.stderr.write("JIG_COMMAND_UNAVAILABLE: the command could not be completed\n");
    }
    return exit(2);
  }
}

function exit(exitCode: number): InstalledCliOutcome {
  return Object.freeze({ exitCode, signal: null });
}

function applyOutcome(outcome: InstalledCliOutcome): void {
  if (outcome.signal !== null) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exitCode = outcome.exitCode ?? 2;
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => { controller.abort(); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let outcome: InstalledCliOutcome;
  try {
    outcome = await runPrivateInstalledCli(process.argv.slice(2), controller.signal);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
  applyOutcome(outcome);
}

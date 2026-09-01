import { describe, expect, test } from "bun:test";
import { constants } from "node:fs";

import {
  acquireOrReexecutePrivateRootlessLinux,
  preparePrivateRootlessLinuxScope,
  type PrivateRootlessLinuxDelegationDependencies,
  type PrivateRootlessLinuxScopeDependencies,
} from "../src/internal/linux-rootless-delegation.js";
import {
  PrivateRootlessLinuxAcquisitionError,
  type PrivateRootlessLinuxAcquisitionObservation,
} from "../src/internal/linux-rootless-acquisition.js";

const UNIT = "jig-0123456789abcdef01234567.scope";
const SCOPE = `/sys/fs/cgroup/user.slice/${UNIT}`;
const CHILD = `${SCOPE}/jig`;
const TOKEN = "ab".repeat(32);
const SOCKET = "jig-rootless-acquisition-0123456789abcdef0123456789abcdef";
const COMMAND = [
  "/opt/jig/node_modules/@oven/bun-linux-x64-baseline/bin/bun",
  "--no-env-file",
  "--no-install",
  "--config=/dev/null",
  "/opt/jig/libexec/installed-cli.js",
] as const;

describe("private rootless Linux delegation", () => {
  test("continues in-process when strict inherited acquisition succeeds", async () => {
    const observation = observed();
    let reexecuted = false;
    const dependencies = orchestrationDependencies({
      acquire: async () => observation,
      reexecute: async () => {
        reexecuted = true;
        throw new Error("must not reexecute");
      },
    });

    await expect(acquireOrReexecutePrivateRootlessLinux(dependencies)).resolves.toEqual({
      kind: "private-rootless-linux-ready/1",
      observation,
    });
    expect(reexecuted).toBe(false);
  });

  test("reexecutes the exact current command once through the fixed manager", async () => {
    const environment = { KEEP: "exact" };
    let request: unknown;
    const dependencies = orchestrationDependencies({
      acquire: async () => { throw new PrivateRootlessLinuxAcquisitionError(); },
      environment: () => environment,
      currentCommand: () => [...COMMAND, "run", "answer"],
      currentDirectory: () => "/project",
      nonce: () => "0123456789abcdef01234567",
      resolveManager: async () => "/bin/systemd-run",
      reexecute: async (managerPath, unit, command, directory, actualEnvironment) => {
        request = { managerPath, unit, command, directory, environment: actualEnvironment };
        return {
          kind: "private-rootless-linux-reexecuted/1",
          exitCode: 7,
          signal: null,
        };
      },
    });

    await expect(acquireOrReexecutePrivateRootlessLinux(dependencies)).resolves.toEqual({
      kind: "private-rootless-linux-reexecuted/1",
      exitCode: 7,
      signal: null,
    });
    expect(request).toEqual({
      managerPath: "/bin/systemd-run",
      unit: UNIT,
      command: [...COMMAND, "run", "answer"],
      directory: "/project",
      environment,
    });
  });

  test("prepares only the marked child scope and acknowledges strict reacquisition", async () => {
    const environment: NodeJS.ProcessEnv = {
      JIG_PRIVATE_ROOTLESS_SCOPE: UNIT,
      JIG_PRIVATE_ROOTLESS_READY_SOCKET: SOCKET,
      JIG_PRIVATE_ROOTLESS_READY_TOKEN: TOKEN,
    };
    const acquisition = [new PrivateRootlessLinuxAcquisitionError(), observed()];
    const prepared: string[] = [];
    const acknowledged: unknown[] = [];
    const dependencies = orchestrationDependencies({
      acquire: async () => {
        const value = acquisition.shift();
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error("unexpected acquisition");
        return value;
      },
      environment: () => environment,
      prepareScope: async (unit) => { prepared.push(unit); },
      acknowledgeReady: async (marker, delegatedCgroup) => {
        acknowledged.push({ marker, delegatedCgroup });
      },
    });

    await expect(acquireOrReexecutePrivateRootlessLinux(dependencies)).resolves.toMatchObject({
      kind: "private-rootless-linux-ready/1",
    });
    expect(prepared).toEqual([UNIT]);
    expect(acknowledged).toEqual([{
      marker: { unit: UNIT, socketPath: SOCKET, token: TOKEN },
      delegatedCgroup: SCOPE,
    }]);
    expect(environment).toEqual({});
  });

  test("collapses invalid child state and missing manager support to one error", async () => {
    for (const dependencies of [
      orchestrationDependencies({
        acquire: async () => { throw new Error("private host detail"); },
        environment: () => ({ JIG_PRIVATE_ROOTLESS_SCOPE: UNIT }),
      }),
      orchestrationDependencies({
        acquire: async () => { throw new Error("private host detail"); },
        resolveManager: async () => { throw new Error("manager detail"); },
      }),
      orchestrationDependencies({
        acquire: async () => { throw new Error("private host detail"); },
        reexecute: async () => { throw new Error("user manager failed"); },
      }),
    ]) {
      const error = await acquireOrReexecutePrivateRootlessLinux(dependencies)
        .then(() => undefined, (failure) => failure);
      expect(error).toBeInstanceOf(PrivateRootlessLinuxAcquisitionError);
      expect(error).toMatchObject({
        code: "SANDBOX_UNAVAILABLE",
        message: "the required rootless Linux sandbox is unavailable",
      });
      expect(String(error)).not.toContain("detail");
    }
  });
});

describe("private transient scope preparation", () => {
  test("moves every scope process into one child before enabling controllers", async () => {
    const fixture = scopeFixture();
    await preparePrivateRootlessLinuxScope(UNIT, fixture.dependencies);

    expect(fixture.directories).toEqual([CHILD]);
    expect(fixture.writes).toEqual([
      { path: `${CHILD}/cgroup.procs`, value: "55\n" },
      { path: `${CHILD}/cgroup.procs`, value: "44\n" },
      { path: `${SCOPE}/cgroup.subtree_control`, value: "+cpu +memory +pids\n" },
    ]);
    expect(fixture.processes).toEqual([]);
    expect(fixture.accesses).toContainEqual({
      path: `${SCOPE}/cgroup.subtree_control`,
      mode: constants.R_OK | constants.W_OK,
    });
    expect(fixture.accesses).toContainEqual({
      path: `${SCOPE}/cgroup.kill`,
      mode: constants.W_OK,
    });
  });

  test("refuses a different scope, pre-existing child, or incomplete process move", async () => {
    const wrongScope = scopeFixture();
    wrongScope.text.set("/proc/self/cgroup", "0::/user.slice/not-the-requested.scope\n");
    await expect(preparePrivateRootlessLinuxScope(UNIT, wrongScope.dependencies)).rejects.toThrow();
    expect(wrongScope.directories).toEqual([]);

    const existingChild = scopeFixture();
    existingChild.children.push("existing");
    await expect(preparePrivateRootlessLinuxScope(UNIT, existingChild.dependencies)).rejects.toThrow();
    expect(existingChild.directories).toEqual([]);

    const missingSelf = scopeFixture();
    missingSelf.processes.splice(0, Infinity, 55);
    await expect(preparePrivateRootlessLinuxScope(UNIT, missingSelf.dependencies)).rejects.toThrow();
  });
});

function observed(): PrivateRootlessLinuxAcquisitionObservation {
  return Object.freeze({
    kind: "private-rootless-linux-acquisition/1" as const,
    delegatedCgroup: SCOPE,
    currentCgroup: CHILD,
    bubblewrapPath: "/usr/bin/bwrap",
    bubblewrapVersion: "0.12.0",
    payloadUid: 1_000,
    payloadGid: 100,
  });
}

function orchestrationDependencies(
  override: Partial<PrivateRootlessLinuxDelegationDependencies>,
): PrivateRootlessLinuxDelegationDependencies {
  return {
    acquire: async () => { throw new Error("unavailable"); },
    environment: () => ({}),
    currentCommand: () => [...COMMAND],
    currentDirectory: () => "/project",
    nonce: () => "0123456789abcdef01234567",
    resolveManager: async () => "/usr/bin/systemd-run",
    prepareScope: async () => undefined,
    acknowledgeReady: async () => undefined,
    reexecute: async () => ({
      kind: "private-rootless-linux-reexecuted/1",
      exitCode: 0,
      signal: null,
    }),
    ...override,
  };
}

interface ScopeFixture {
  readonly text: Map<string, string>;
  readonly children: string[];
  readonly processes: number[];
  readonly directories: string[];
  readonly accesses: Array<{ readonly path: string; readonly mode: number }>;
  readonly writes: Array<{ readonly path: string; readonly value: string }>;
  readonly dependencies: PrivateRootlessLinuxScopeDependencies;
}

function scopeFixture(): ScopeFixture {
  const fixture = {
    text: new Map<string, string>([
      ["/proc/self/cgroup", `0::/user.slice/${UNIT}\n`],
      [`${SCOPE}/cgroup.controllers`, "cpu io memory pids\n"],
    ]),
    children: [] as string[],
    processes: [44, 55],
    directories: [] as string[],
    accesses: [] as Array<{ readonly path: string; readonly mode: number }>,
    writes: [] as Array<{ readonly path: string; readonly value: string }>,
  } as ScopeFixture;
  fixture.dependencies = {
    uid: () => 1_000,
    pid: () => 44,
    readText: async (path) => {
      if (path === `${SCOPE}/cgroup.procs`) return fixture.processes.map(String).join("\n") +
        (fixture.processes.length === 0 ? "" : "\n");
      const value = fixture.text.get(path);
      if (value === undefined) throw new Error(`unexpected read: ${path}`);
      return value;
    },
    listDirectories: async (path) => {
      if (path !== SCOPE) throw new Error(`unexpected directory listing: ${path}`);
      return [...fixture.children];
    },
    information: async (path) => {
      if (path !== SCOPE) throw new Error(`unexpected information: ${path}`);
      return { uid: 1_000, mode: 0o755, isDirectory: () => true, isFile: () => false };
    },
    filesystemType: async () => 0x6367_7270n,
    resolve: async (path) => path,
    requireAccess: async (path, mode) => { fixture.accesses.push({ path, mode }); },
    makeDirectory: async (path) => {
      fixture.directories.push(path);
      fixture.children.push(path.slice(SCOPE.length + 1));
    },
    writeText: async (path, value) => {
      fixture.writes.push({ path, value });
      if (path === `${CHILD}/cgroup.procs`) {
        const processId = Number(value.trim());
        const index = fixture.processes.indexOf(processId);
        if (index >= 0) fixture.processes.splice(index, 1);
      }
    },
  };
  return fixture;
}

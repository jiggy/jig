import { describe, expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBareProject, type BareInitFileSystem } from "../src/bare-init.js";
import {
  main,
  privateCliCommandLifetimeMs,
  type PrivateCliCommandHost,
  type PrivateCliOptions,
} from "../src/cli.js";
import {
  ProjectAdministrationError,
  type ProjectPlanResult,
  type ProjectSession,
} from "../src/administration/project.js";
import type {
  RootAdministration,
  RootRunStatus,
  RootRunTerminal,
  StartRootRunRequest,
} from "../src/administration/root.js";

const cli = resolve(import.meta.dir, "../src/cli.ts");

test("jig init --bare creates only the fixed inert project envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-"));
  const destination = join(root, "project");
  try {
    const initialized = Bun.spawn([process.execPath, cli, "init", "--bare", destination], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await initialized.exited).toBe(0);
    expect(await new Response(initialized.stdout).text()).toBe("created bare Jig project\n");
    expect(await new Response(initialized.stderr).text()).toBe("");

    expect((await readdir(destination)).sort()).toEqual([
      ".gitignore",
      "bindings",
      "flows",
      "jig.ts",
    ]);
    expect(await readdir(join(destination, "flows"))).toEqual([]);
    expect(await readdir(join(destination, "bindings"))).toEqual([]);
    expect(await readFile(join(destination, ".gitignore"), "utf8")).toBe(
      ".jig/\n",
    );
    expect(await readFile(join(destination, "jig.ts"), "utf8")).toBe([
      'import { defineJig, discover } from "@jigging/jig";',
      "",
      "export default defineJig({",
      '  flows: discover("./flows"),',
      '  bindings: discover("./bindings"),',
      "});",
      "",
    ].join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("jig init --bare rejects an existing destination without changing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-existing-"));
  const destination = join(root, "project");
  try {
    await mkdir(destination);
    await writeFile(join(destination, "owned.txt"), "keep\n");

    const initialized = Bun.spawn([process.execPath, cli, "init", "--bare", destination], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await initialized.exited).toBe(1);
    expect(await new Response(initialized.stdout).text()).toBe("");
    const diagnostic = await new Response(initialized.stderr).text();
    expect(diagnostic).toBe(
      "JIG_INIT_DESTINATION_EXISTS: the destination already exists\n",
    );
    expect(diagnostic).not.toContain(destination);
    expect(await readFile(join(destination, "owned.txt"), "utf8")).toBe("keep\n");
    expect(await readdir(root)).toEqual(["project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("jig init --bare closes unavailable filesystem diagnostics", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-unavailable-"));
  const destination = join(root, "missing-parent", "project");
  try {
    const initialized = Bun.spawn([process.execPath, cli, "init", "--bare", destination], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await initialized.exited).toBe(2);
    expect(await new Response(initialized.stdout).text()).toBe("");
    const diagnostic = await new Response(initialized.stderr).text();
    expect(diagnostic).toBe(
      "JIG_INIT_UNAVAILABLE: the destination cannot be initialized\n",
    );
    expect(diagnostic).not.toContain(destination);
    expect(diagnostic).not.toContain("ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bare initialization removes only its own entries after a controlled write failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-failure-"));
  const destination = join(root, "project");
  const fileSystem: BareInitFileSystem = {
    mkdir,
    rmdir,
    unlink,
    writeFile: (async (path, data, options) => {
      if (String(path).endsWith("/jig.ts")) throw new Error("injected write failure");
      await writeFile(path, data, options);
    }) as typeof writeFile,
  };
  try {
    await expect(createBareProject(destination, fileSystem)).rejects.toMatchObject({
      code: "JIG_INIT_UNAVAILABLE",
      message: "the destination cannot be initialized",
    });
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bare initialization never removes unknown concurrent content", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-foreign-"));
  const destination = join(root, "project");
  let injected = false;
  const fileSystem: BareInitFileSystem = {
    mkdir,
    rmdir,
    unlink,
    writeFile: (async (path, data, options) => {
      if (!injected && String(path).endsWith("/.gitignore")) {
        injected = true;
        await writeFile(join(destination, "foreign.txt"), "keep\n");
        throw new Error("injected write failure");
      }
      await writeFile(path, data, options);
    }) as typeof writeFile,
  };
  try {
    await expect(createBareProject(destination, fileSystem)).rejects.toMatchObject({
      code: "JIG_INIT_CLEANUP_FAILED",
      message: "initialization failed and its created files could not be removed",
    });
    expect(await readFile(join(destination, "foreign.txt"), "utf8")).toBe("keep\n");
    expect(await readdir(destination)).toEqual(["foreign.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent bare initializers have exactly one winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-init-concurrent-"));
  const destination = join(root, "project");
  try {
    const runs = [0, 1].map(() => Bun.spawn(
      [process.execPath, cli, "init", "--bare", destination],
      { stdout: "pipe", stderr: "pipe" },
    ));
    const results = await Promise.all(runs.map(async (run) => ({
      exit: await run.exited,
      stdout: await new Response(run.stdout).text(),
      stderr: await new Response(run.stderr).text(),
    })));
    expect(results.map((result) => result.exit).sort()).toEqual([0, 1]);
    expect(results.filter((result) => result.exit === 0)[0]?.stdout).toBe(
      "created bare Jig project\n",
    );
    expect(results.filter((result) => result.exit === 1)[0]?.stderr).toBe(
      "JIG_INIT_DESTINATION_EXISTS: the destination already exists\n",
    );
    expect((await readdir(destination)).sort()).toEqual([
      ".gitignore", "bindings", "flows", "jig.ts",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("finite Jig project commands", () => {
  const digest = `sha256:${"a".repeat(64)}`;

  test("help exposes only init, check, and run", async () => {
    for (const arguments_ of [
      ["--help"],
      ["init", "--help"],
      ["check", "-h"],
      ["run", "--help"],
    ]) {
      const invocation = commandInvocation(unusedHost());
      expect(await main(arguments_, invocation.options)).toBe(0);
      expect(invocation.output).toContain("jig init --bare <directory>");
      expect(invocation.output).toContain("jig check [project] [--yes]");
      expect(invocation.output).toContain(
        "jig run <flow:path|binding:id> [--input JSON] [--timeout DURATION]",
      );
      expect(invocation.output).not.toContain("package check");
      expect(invocation.error).toBe("");
    }

    const removed = commandInvocation(unusedHost());
    expect(await main(["package", "check", "."], removed.options)).toBe(2);
    expect(removed.error).toContain("Usage:");
  });

  test("check plans a fixed update and closes one unchanged session", async () => {
    const events: string[] = [];
    const host = fakeHost(fakeSession(events), events);
    const invocation = commandInvocation(host);

    expect(await main(["check"], invocation.options)).toBe(0);
    expect(events).toEqual(["acquire:/project", "plan:update", "close"]);
    expect(invocation.output).toBe("project is ready\n");
    expect(invocation.error).toBe("");
  });

  test("check reviews and applies an opaque token within the same session", async () => {
    const events: string[] = [];
    const plan: ProjectPlanResult = {
      state: "applicable",
      operation: "admission",
      planDigest: digest,
      review: { mediaType: "text/plain; charset=utf-8", text: "review project changes\n" },
    };
    const host = fakeHost(fakeSession(events, { plan }), events);
    const invocation = commandInvocation(host);

    expect(await main(["check", "workspace", "--yes"], invocation.options)).toBe(0);
    expect(events).toEqual([
      "acquire:workspace",
      "plan:update",
      `apply:${digest}`,
      "close",
    ]);
    expect(invocation.output).toBe("review project changes\nproject is ready\n");
    expect(invocation.output).not.toContain(digest);
    expect(invocation.output).not.toContain("admission");
    expect(invocation.error).toBe("");
  });

  test("check requires TTY confirmation unless --yes is explicit", async () => {
    const plan: ProjectPlanResult = {
      state: "applicable",
      operation: "lock-repair",
      planDigest: digest,
      review: { mediaType: "text/plain; charset=utf-8", text: "review\n" },
    };
    const nonInteractiveEvents: string[] = [];
    const nonInteractive = commandInvocation(
      fakeHost(fakeSession(nonInteractiveEvents, { plan }), nonInteractiveEvents),
    );
    expect(await main(["check"], nonInteractive.options)).toBe(2);
    expect(nonInteractiveEvents).toEqual(["acquire:/project", "plan:update", "close"]);
    expect(nonInteractive.output).toBe("review\n");
    expect(nonInteractive.error).toBe(
      "JIG_APPROVAL_REQUIRED: project changes require confirmation; rerun with --yes\n",
    );

    const declinedEvents: string[] = [];
    let prompt = "";
    const declined = commandInvocation(
      fakeHost(fakeSession(declinedEvents, { plan }), declinedEvents),
      {
        interactive: true,
        confirm: async (value) => {
          prompt = value;
          return false;
        },
      },
    );
    expect(await main(["check"], declined.options)).toBe(1);
    expect(prompt).toBe("Apply these project changes? [y/N] ");
    expect(declinedEvents).toEqual(["acquire:/project", "plan:update", "close"]);
    expect(declined.error).toBe("JIG_CHANGES_DECLINED: project changes were not applied\n");
  });

  test("run uses the current project, explicit Flow target, default input, and no planning", async () => {
    const events: string[] = [];
    const terminal: RootRunTerminal = {
      status: "succeeded",
      outcome: "done",
      output: { ok: true },
      diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
    };
    let request: StartRootRunRequest | undefined;
    let acquisition: { readonly runTimeoutMs?: number } | undefined;
    const host = fakeHost(fakeSession(events, {
      terminal,
      captureRequest: (value) => { request = value; },
      pendingObservations: 1,
    }), events, async () => { events.push("pause"); }, (value) => { acquisition = value; });
    const invocation = commandInvocation(host, { createSubmissionId: () => "private-submission" });

    expect(await main(["run", "flow:./flows/work"], invocation.options)).toBe(0);
    expect(acquisition).toEqual({ runTimeoutMs: 30_000 });
    expect(request).toEqual({
      submissionId: "private-submission",
      target: { kind: "flow", path: "flows/work" },
      input: {},
    });
    expect(events).toEqual([
      "acquire:/project",
      "start",
      "status",
      "pause",
      "status",
      "close",
    ]);
    expect(events).not.toContain("plan:update");
    expect(JSON.parse(invocation.output)).toEqual(terminal);
    expect(invocation.output).not.toContain(digest);
    expect(invocation.output).not.toContain("private-submission");
    expect(invocation.error).toBe("");
  });

  test("run accepts timeout units and input in either option order", async () => {
    const cases = [
      { input: "ms", timeoutMs: 1, options: ["--timeout", "1ms", "--input", '{"case":"ms"}'] },
      { input: "s", timeoutMs: 2_000, options: ["--input", '{"case":"s"}', "--timeout", "2s"] },
      { input: "m", timeoutMs: 180_000, options: ["--timeout", "3m", "--input", '{"case":"m"}'] },
      { input: "h", timeoutMs: 86_400_000, options: ["--input", '{"case":"h"}', "--timeout", "24h"] },
    ] as const;

    for (const { input, timeoutMs, options } of cases) {
      const events: string[] = [];
      let request: StartRootRunRequest | undefined;
      let acquisition: { readonly runTimeoutMs?: number } | undefined;
      const invocation = commandInvocation(fakeHost(fakeSession(events, {
        captureRequest: (value) => { request = value; },
      }), events, undefined, (value) => { acquisition = value; }), {
        createSubmissionId: () => "timeout-submission",
      });

      expect(await main(["run", "binding:review", ...options], invocation.options)).toBe(0);
      expect(acquisition).toEqual({ runTimeoutMs: timeoutMs });
      expect(request).toEqual({
        submissionId: "timeout-submission",
        target: { kind: "binding", id: "review" },
        input: { case: input },
      });
      expect(invocation.error).toBe("");
    }
  });

  test("run rejects malformed, zero, overflowing, and over-limit timeouts before acquisition", async () => {
    for (const duration of [
      "",
      "0ms",
      "01ms",
      "+1s",
      "1.5s",
      "1",
      "1d",
      "24h1m",
      "25h",
      "86400001ms",
      "9007199254740992ms",
    ]) {
      const invocation = commandInvocation(unusedHost());
      expect(await main([
        "run",
        "flow:flows/work",
        "--timeout",
        duration,
      ], invocation.options), duration).toBe(1);
      expect(invocation.error).toBe(
        "JIG_RUN_TIMEOUT_INVALID: --timeout must be a positive integer followed by " +
        "ms, s, m, or h, up to 24h\n",
      );
    }

    const duplicate = commandInvocation(unusedHost());
    expect(await main([
      "run",
      "flow:flows/work",
      "--timeout",
      "1s",
      "--timeout",
      "2s",
    ], duplicate.options)).toBe(2);
    expect(duplicate.error).toContain("Usage:");
  });

  test("installed command lifetime encloses Run cleanup without extending invalid commands", () => {
    expect(privateCliCommandLifetimeMs(["run", "flow:flows/work"])).toBe(330_000);
    expect(privateCliCommandLifetimeMs([
      "run",
      "flow:flows/work",
      "--input",
      "{}",
      "--timeout",
      "24h",
    ])).toBe(86_700_000);
    expect(privateCliCommandLifetimeMs(["run", "flow:flows/work", "--timeout", "invalid"])).toBe(
      300_000,
    );
    expect(privateCliCommandLifetimeMs(["check"])).toBe(300_000);
  });

  test("run parses bounded JSON/1 and maps failure and loss to stable exits", async () => {
    const cases: readonly [RootRunTerminal, number][] = [
      [{
        status: "failed",
        code: "INVALID_RESULT",
        message: "result rejected",
        details: { field: "output" },
        diagnostics: { stderr: "bad", stderrBytes: 3, stderrTruncated: false },
      }, 1],
      [{ status: "lost", code: "COORDINATOR_LOST", message: "owner lost" }, 2],
    ];
    for (const [terminal, expectedExit] of cases) {
      const events: string[] = [];
      let request: StartRootRunRequest | undefined;
      const invocation = commandInvocation(fakeHost(fakeSession(events, {
        terminal,
        captureRequest: (value) => { request = value; },
      }), events));
      expect(await main([
        "run",
        "binding:review",
        "--input",
        '{"task":"build","count":2}',
      ], invocation.options)).toBe(expectedExit);
      expect(request?.target).toEqual({ kind: "binding", id: "review" });
      expect(request?.input).toEqual({ task: "build", count: 2 });
      expect(JSON.parse(invocation.output)).toEqual(terminal);
      expect(Object.keys(JSON.parse(invocation.output))).not.toContain("runId");
      expect(invocation.error).toBe("");
    }
  });

  test("run rejects invalid target and JSON/1 before acquiring a project", async () => {
    const target = commandInvocation(unusedHost());
    expect(await main(["run", "work"], target.options)).toBe(1);
    expect(target.error).toBe(
      "JIG_RUN_TARGET_INVALID: the target must be flow:<path> or binding:<id>\n",
    );

    const input = commandInvocation(unusedHost());
    expect(await main(["run", "flow:flows/work", "--input", '{"x":1,"x":2}'], input.options)).toBe(1);
    expect(input.error).toBe("JIG_RUN_INPUT_INVALID: --input must be FLOW JSON/1\n");

    const usage = commandInvocation(unusedHost());
    expect(await main(["check", "--yes", "project"], usage.options)).toBe(2);
    expect(usage.error).toContain("Usage:");
  });

  test("interrupting a pending Run closes the session and reports no private state", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const host = fakeHost(fakeSession(events, {
      terminal: { status: "lost", code: "COORDINATOR_LOST", message: "unused" },
      pendingObservations: Number.POSITIVE_INFINITY,
    }), events, async () => {
      events.push("pause");
      controller.abort();
    });
    const invocation = commandInvocation(host, { signal: controller.signal });

    expect(await main(["run", "flow:flows/work"], invocation.options)).toBe(2);
    expect(events).toEqual(["acquire:/project", "start", "status", "pause", "close"]);
    expect(invocation.output).toBe("");
    expect(invocation.error).toBe("JIG_COMMAND_INTERRUPTED: the command was interrupted\n");
  });

  test("unexpected failures are closed without leaking their messages", async () => {
    const invocation = commandInvocation({
      async acquire() { throw new Error("ENOENT /private/project/.jig/store.sqlite"); },
    });
    expect(await main(["check", "project", "--yes"], invocation.options)).toBe(2);
    expect(invocation.error).toBe(
      "JIG_COMMAND_UNAVAILABLE: the command could not be completed\n",
    );
  });

  test("renders invalid project diagnostics with terminal-safe relative locations", async () => {
    const events: string[] = [];
    const failure = new ProjectAdministrationError(
      "INVALID_CANDIDATE",
      "project candidate is invalid",
      {
        code: "PROJECT_BINDING_SETTINGS_INVALID",
        path: "bindings/review-\u202e.ts",
        pointer: "/settings/prefix\n",
      },
    );
    const invocation = commandInvocation(fakeHost(fakeSession(events, { planFailure: failure }), events));

    expect(await main(["check", "--yes"], invocation.options)).toBe(1);
    expect(events).toEqual(["acquire:/project", "plan:update", "close"]);
    expect(invocation.output).toBe("");
    expect(invocation.error).toBe(
      "INVALID_CANDIDATE: the project definition is invalid; " +
      "PROJECT_BINDING_SETTINGS_INVALID at " +
      '"bindings/review-\\u202e.ts" pointer "/settings/prefix\\u000a"\n',
    );
    expect(invocation.error).not.toContain("\u202e");
  });

  test("renders a bounded package unavailability without exposing its private message", async () => {
    const events: string[] = [];
    const failure = new ProjectAdministrationError(
      "UNAVAILABLE",
      "private preparation message and /private/path",
      {
        code: "PACKAGE_BUN_SOURCE_UNSUPPORTED",
        path: "flows/dependent/bun.lock",
      },
    );
    const invocation = commandInvocation(fakeHost(fakeSession(events, { planFailure: failure }), events));

    expect(await main(["check", "--yes"], invocation.options)).toBe(2);
    expect(events).toEqual(["acquire:/project", "plan:update", "close"]);
    expect(invocation.output).toBe("");
    expect(invocation.error).toBe(
      "UNAVAILABLE: the project command is unavailable; " +
      'PACKAGE_BUN_SOURCE_UNSUPPORTED at "flows/dependent/bun.lock"\n',
    );
    expect(invocation.error).not.toContain("private preparation message");
    expect(invocation.error).not.toContain("/private/path");
  });

  interface FakeSessionOptions {
    readonly plan?: ProjectPlanResult;
    readonly planFailure?: unknown;
    readonly terminal?: RootRunTerminal;
    readonly captureRequest?: (request: StartRootRunRequest) => void;
    readonly pendingObservations?: number;
  }

  function fakeSession(events: string[], options: FakeSessionOptions = {}): ProjectSession {
    let observations = 0;
    let closure: Promise<void> | undefined;
    const terminal = options.terminal ?? {
      status: "succeeded" as const,
      outcome: "done",
      output: null,
      diagnostics: { stderr: "", stderrBytes: 0, stderrTruncated: false },
    };
    const rootAdministration: RootAdministration = {
      async startRun(request) {
        events.push("start");
        options.captureRequest?.(request);
        return { runId: digest };
      },
      async runStatus(): Promise<RootRunStatus> {
        events.push("status");
        observations += 1;
        const common = {
          runId: digest,
          submissionId: "private-submission",
          target: { kind: "flow" as const, path: "flows/work" },
        };
        return observations <= (options.pendingObservations ?? 0)
          ? { ...common, state: "pending" }
          : { ...common, state: "terminal", terminal };
      },
    };
    return {
      rootAdministration,
      async plan(request) {
        events.push(`plan:${request.lockMode}`);
        if (options.planFailure !== undefined) throw options.planFailure;
        return options.plan ?? { state: "unchanged" };
      },
      async apply(request) {
        events.push(`apply:${request.planDigest}`);
        return { operation: "admission", planDigest: request.planDigest };
      },
      close() {
        closure ??= Promise.resolve().then(() => { events.push("close"); });
        return closure;
      },
    };
  }

  function fakeHost(
    session: ProjectSession,
    events: string[],
    pause?: (milliseconds: number) => Promise<void>,
    captureAcquisition?: (
      options: { readonly runTimeoutMs?: number } | undefined,
    ) => void,
  ): PrivateCliCommandHost {
    return {
      async acquire(project, options) {
        events.push(`acquire:${project}`);
        captureAcquisition?.(options);
        return session;
      },
      ...(pause === undefined ? {} : { pause }),
    };
  }

  function unusedHost(): PrivateCliCommandHost {
    return {
      async acquire(): Promise<ProjectSession> {
        throw new Error("project acquisition was not expected");
      },
    };
  }

  function commandInvocation(
    host: PrivateCliCommandHost,
    extra: Omit<PrivateCliOptions, "host" | "currentDirectory" | "writeOutput" | "writeError"> = {},
  ): {
    readonly options: PrivateCliOptions;
    readonly output: string;
    readonly error: string;
  } {
    const capture = { output: "", error: "" };
    const options: PrivateCliOptions = {
      host,
      currentDirectory: "/project",
      interactive: false,
      ...extra,
      writeOutput: (text) => { capture.output += text; },
      writeError: (text) => { capture.error += text; },
    };
    return {
      options,
      get output() { return capture.output; },
      get error() { return capture.error; },
    };
  }
});

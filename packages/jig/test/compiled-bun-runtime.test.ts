import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RunHostSession, type ExactComponentProcess } from "../src/run/session.js";

const PROOF = process.env.JIG_COMPILED_BUN_PROOF === "1";
const proofDescribe = PROOF ? describe.serial : describe.skip;
const BUN_POLICY = ["--no-env-file", "--no-install", "--config=/dev/null"] as const;
const EXPECTED_INTERPRETER = "/lib64/ld-linux-x86-64.so.2";
const REQUIRED_LIBRARIES = ["libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0"] as const;

proofDescribe("private compiled Bun runtime", () => {
  test("runs a real FLOW Run/1 component and descendant without ambient Bun", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error("compiled Bun proof requires Linux x64");
    }

    const root = await mkdtemp(join(tmpdir(), "jig-compiled-bun-proof-"));
    const artifact = join(root, "jig");
    const packageRoot = join(root, "package");
    const libraryRoot = join(root, "lib");
    const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const sdk = fileURLToPath(new URL("../../flow-sdk", import.meta.url));

    try {
      await mkdir(packageRoot);
      await mkdir(libraryRoot);
      await compileArtifact(cli, artifact);

      const bytes = new Uint8Array(await Bun.file(artifact).arrayBuffer());
      expect(new TextDecoder().decode(bytes.subarray(1, 4))).toBe("ELF");
      expect(elfInterpreter(bytes)).toBe(EXPECTED_INTERPRETER);

      const loader = await realpath(EXPECTED_INTERPRETER);
      for (const name of REQUIRED_LIBRARIES) {
        await copyFile(join(dirname(loader), name), join(libraryRoot, name));
      }

      await writeFile(join(packageRoot, "flow.ts"), `
        import { serve } from "/flow-sdk/src/index.ts";

        await serve(async (run) => {
          const child = Bun.spawnSync([
            process.execPath,
            "--no-env-file",
            "--no-install",
            "--config=/dev/null",
            "-e",
            "process.stdout.write(Bun.version)",
          ]);
          return {
            outcome: "done",
            output: {
              input: run.input,
              runtime: Bun.version,
              childRuntime: new TextDecoder().decode(child.stdout),
              childExit: child.exitCode,
              executable: process.execPath,
            },
          };
        });
      `, "utf8");

      const child = spawn("/usr/bin/bwrap", [
        "--die-with-parent",
        "--new-session",
        "--unshare-all",
        "--proc", "/proc",
        "--dev", "/dev",
        "--tmpfs", "/tmp",
        "--dir", "/work",
        "--dir", "/lib64",
        "--ro-bind", loader, EXPECTED_INTERPRETER,
        "--ro-bind", libraryRoot, "/jig-lib",
        "--ro-bind", artifact, "/jig",
        "--ro-bind", packageRoot, "/package",
        "--ro-bind", sdk, "/flow-sdk",
        "--setenv", "BUN_BE_BUN", "1",
        "--setenv", "LD_LIBRARY_PATH", "/jig-lib",
        "--chdir", "/work",
        "--",
        "/jig",
        ...BUN_POLICY,
        "/package/flow.ts",
      ], { cwd: "/", env: {}, stdio: ["pipe", "pipe", "pipe"] });

      const terminal = await new RunHostSession(component(child), {
        input: { request: "compiled-runtime" },
        settings: {},
        attachments: {},
        scratch: "/tmp/run",
        deadlineUnixMs: Date.now() + 10_000,
      }).run();

      expect(terminal).toMatchObject({
        status: "succeeded",
        result: {
          outcome: "done",
          output: {
            input: { request: "compiled-runtime" },
            runtime: Bun.version,
            childRuntime: Bun.version,
            childExit: 0,
            executable: "/jig",
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

async function compileArtifact(entrypoint: string, artifact: string): Promise<void> {
  const child = Bun.spawn([
    process.execPath,
    "build",
    "--compile",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    // An explicit cross-target makes the artifact independent of the
    // development host's current Bun executable.
    "--target=bun-linux-x64-baseline",
    entrypoint,
    `--outfile=${artifact}`,
  ], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: {},
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`compiled Jig build failed (${exitCode}): ${stderr || stdout}`);
  }
}

function elfInterpreter(bytes: Uint8Array): string {
  if (bytes.byteLength < 64 || bytes[0] !== 0x7f || bytes[1] !== 0x45 ||
      bytes[2] !== 0x4c || bytes[3] !== 0x46 || bytes[4] !== 2) {
    throw new Error("compiled Jig artifact is not ELF64");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const littleEndian = bytes[5] === 1;
  const tableOffset = Number(view.getBigUint64(32, littleEndian));
  const entrySize = view.getUint16(54, littleEndian);
  const entryCount = view.getUint16(56, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const offset = tableOffset + index * entrySize;
    if (view.getUint32(offset, littleEndian) !== 3) continue;
    const valueOffset = Number(view.getBigUint64(offset + 8, littleEndian));
    const valueSize = Number(view.getBigUint64(offset + 32, littleEndian));
    return new TextDecoder().decode(bytes.subarray(valueOffset, valueOffset + valueSize))
      .replace(/\0.*$/s, "");
  }
  throw new Error("compiled Jig artifact has no ELF interpreter");
}

function component(child: ChildProcessWithoutNullStreams): ExactComponentProcess {
  let inputClosed = false;
  const completion = new Promise<{ exitCode: number | null; signal: string | null; fenced: true }>((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal, fenced: true }));
  });
  return {
    stdout: stream(child.stdout),
    stderr: stream(child.stderr),
    completion,
    write: async (bytes) => {
      if (inputClosed) throw new Error("compiled runtime input is closed");
      if (!child.stdin.write(bytes)) await new Promise<void>((resolve) => child.stdin.once("drain", resolve));
    },
    closeInput: async () => {
      if (inputClosed) return;
      inputClosed = true;
      child.stdin.end();
    },
    terminate: async () => {
      child.kill("SIGKILL");
      await completion;
    },
  };
}

async function* stream(input: NodeJS.ReadableStream): AsyncGenerator<Uint8Array> {
  for await (const chunk of input) yield new Uint8Array(Buffer.from(chunk));
}

import { expect, test } from "bun:test";
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
      "package.json",
      "tsconfig.json",
    ]);
    expect(await readdir(join(destination, "flows"))).toEqual([]);
    expect(await readdir(join(destination, "bindings"))).toEqual([]);
    expect(await readFile(join(destination, ".gitignore"), "utf8")).toBe(
      ".jig/\nnode_modules/\n",
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
    const shipped = JSON.parse(await readFile(resolve(import.meta.dir, "../package.json"), "utf8"));
    expect(JSON.parse(await readFile(join(destination, "package.json"), "utf8"))).toEqual({
      private: true,
      type: "module",
      dependencies: { "@jigging/jig": shipped.version },
      devDependencies: { typescript: "7.0.2" },
    });
    expect(JSON.parse(await readFile(join(destination, "tsconfig.json"), "utf8"))).toEqual({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["jig.ts", "bindings/**/*.ts"],
    });
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
    await expect(createBareProject(destination, "1.2.3", fileSystem)).rejects.toMatchObject({
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
    await expect(createBareProject(destination, "1.2.3", fileSystem)).rejects.toMatchObject({
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
      ".gitignore", "bindings", "flows", "jig.ts", "package.json", "tsconfig.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("jig package check reports inert package validity without readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "jig-cli-test-"));
  try {
    await writeFile(join(root, "FLOW.md"), "---\nname: demo\ndescription: Demo.\n---\n");
    const valid = Bun.spawn([process.execPath, cli, "package", "check", root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(valid.stdout).text();
    const diagnostics = await new Response(valid.stderr).text();
    expect(await valid.exited).toBe(0);
    expect(diagnostics).toBe("");
    expect(output).toContain("valid FLOW run package: demo");
    expect(output).toContain("implementation: instruction");
    expect(output).not.toContain("READY");

    await rm(join(root, "FLOW.md"));
    const invalid = Bun.spawn([process.execPath, cli, "package", "check", root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const invalidOutput = await new Response(invalid.stdout).text();
    const invalidDiagnostics = await new Response(invalid.stderr).text();
    expect(await invalid.exited).toBe(1);
    expect(invalidOutput).toBe("");
    expect(invalidDiagnostics).toContain("PACKAGE_FLOW_MISSING");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("jig package check reserves exit 2 for usage or unavailable checking", async () => {
  const usage = Bun.spawn([process.execPath, cli, "package", "check"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await usage.exited).toBe(2);
  expect(await new Response(usage.stderr).text()).toContain("Usage:");

  const missing = Bun.spawn([process.execPath, cli, "package", "check", "/path/which/does/not/exist"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await missing.exited).toBe(2);
  expect(await new Response(missing.stderr).text()).toContain("PACKAGE_SOURCE_IO");
});

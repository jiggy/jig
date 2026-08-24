import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../src/cli.ts");

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

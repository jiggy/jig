import { expect, test } from "bun:test";

test("handle reserves protocol stdout and redirects ordinary logs", async () => {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/fixture-flow.ts`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "host:stdio",
      method: "flow/run",
      params: {
        protocol: "run/1",
        input: { hello: "world" },
        settings: {},
        attachments: {},
        scratch: "/tmp/flow",
        deadlineUnixMs: 4_000_000_000_000,
      },
    })}\n`,
  );
  await child.stdin.flush();

  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  expect(await child.exited).toBe(0);
  expect(error).toBe("handler log\nhandler info\nhandler debug\nafter handle\n");
  expect(output.endsWith("\n")).toBe(true);
  expect(JSON.parse(output)).toEqual({
    jsonrpc: "2.0",
    id: "host:stdio",
    result: {
      outcome: "done",
      output: {
        input: { hello: "world" },
        scratch: "/tmp/flow",
      },
    },
  });
});

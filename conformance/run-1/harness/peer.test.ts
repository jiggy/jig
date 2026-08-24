import { expect, test } from "bun:test";

import { ComponentPeer } from "./peer";

test("component peer rejects a valid trailing frame", async () => {
  const peer = new ComponentPeer([
    process.execPath,
    "-e",
    "process.stdout.write('{\"first\":true}\\n{\"extra\":true}\\n')",
  ]);

  try {
    expect(await peer.receive()).toEqual({ first: true });
    await expect(peer.finish()).rejects.toThrow("unexpected frame");
  } finally {
    await peer.dispose();
  }
});

test("component peer rejects partial trailing output", async () => {
  const peer = new ComponentPeer([
    process.execPath,
    "-e",
    "process.stdout.write('{\"first\":true}\\npartial')",
  ]);

  try {
    expect(await peer.receive()).toEqual({ first: true });
    await expect(peer.finish()).rejects.toThrow("partial frame");
  } finally {
    await peer.dispose();
  }
});

test("component peer drains and permits stderr diagnostics", async () => {
  const peer = new ComponentPeer([
    process.execPath,
    "-e",
    `process.stderr.write("x".repeat(1024 * 1024));
process.stdout.write('{"jsonrpc":"2.0","id":"host:1","result":null}\\n');`,
  ]);

  try {
    expect(await peer.receive()).toEqual({
      jsonrpc: "2.0",
      id: "host:1",
      result: null,
    });
    await peer.finish();
  } finally {
    await peer.dispose();
  }
});

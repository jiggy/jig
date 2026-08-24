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

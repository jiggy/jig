import { describe, expect, test } from "bun:test";

import cases from "./fixtures/framing.json";
import { parseFrame } from "./harness/json1";

const MAX_FRAME_BYTES = 16_777_216;

describe("Run/1 JSON/1 framing", () => {
  for (const fixture of cases.valid) {
    test(`accepts ${fixture.name}`, () => {
      expect(() => parseFrame(hex(fixture.hex))).not.toThrow();
    });
  }

  for (const fixture of cases.invalid) {
    test(`rejects ${fixture.name}`, () => {
      expect(() => parseFrame(hex(fixture.hex))).toThrow();
    });
  }

  test("accepts depth 128 and rejects depth 129", () => {
    expect(() => parseFrame(nested(128))).not.toThrow();
    expect(() => parseFrame(nested(129))).toThrow();
  });

  test("accepts exactly 16 MiB and rejects one byte more", () => {
    expect(() => parseFrame(paddedNull(MAX_FRAME_BYTES))).not.toThrow();
    expect(() => parseFrame(paddedNull(MAX_FRAME_BYTES + 1))).toThrow();
  });
});

function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function nested(depth: number): Uint8Array {
  const containers = depth - 1;
  return new TextEncoder().encode(`${"[".repeat(containers)}null${"]".repeat(containers)}\n`);
}

function paddedNull(payloadBytes: number): Uint8Array {
  const frame = new Uint8Array(payloadBytes + 1);
  frame.fill(0x20);
  frame.set(new TextEncoder().encode("null"));
  frame[payloadBytes] = 0x0a;
  return frame;
}

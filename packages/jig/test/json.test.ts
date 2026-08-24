import { describe, expect, test } from "bun:test";

import {
  JSON_1_LIMITS,
  Json1Error,
  canonicalJson,
  decodeJson1,
  validateJson1,
} from "../src/json.js";

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe("FLOW JSON/1", () => {
  test("parses JSON values without object-prototype semantics", () => {
    const value = decodeJson1(encode('{"__proto__":{"safe":true},"items":[null,false,1.5,"ok"]}'));
    expect(value).toEqual({
      __proto__: { safe: true },
      items: [null, false, 1.5, "ok"],
    });
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.hasOwn(value as object, "__proto__")).toBeTrue();
  });

  for (const [name, bytes] of [
    ["empty input", new Uint8Array()],
    ["UTF-8 BOM", Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])],
    ["invalid UTF-8", Uint8Array.from([0xff])],
    ["duplicate member", encode('{"a":1,"a":2}')],
    ["escaped duplicate member", encode('{"a":1,"\\u0061":2}')],
    ["escaped lone surrogate", encode('"\\ud800"')],
    ["raw lone surrogate", Uint8Array.from([0x22, 0xed, 0xa0, 0x80, 0x22])],
    ["unsafe integral result", encode("9007199254740992")],
    ["infinite result", encode("1e999")],
    ["leading zero", encode("01")],
    ["trailing value", encode("null true")],
  ] as const) {
    test(`rejects ${name}`, () => {
      expect(() => decodeJson1(bytes)).toThrow(Json1Error);
    });
  }

  test("enforces depth with the root at one", () => {
    expect(() => decodeJson1(encode(`${"[".repeat(127)}0${"]".repeat(127)}`))).not.toThrow();
    expect(() => decodeJson1(encode(`${"[".repeat(128)}0${"]".repeat(128)}`))).toThrow(
      Json1Error,
    );
  });

  test("enforces the total canonical encoding bound for in-memory values", () => {
    const left = "a".repeat(8_388_601);
    const right = "b".repeat(8_388_600);
    const exact = { a: left, b: right };
    expect(() => validateJson1(exact)).not.toThrow();
    expect(canonicalJson(exact).byteLength).toBe(JSON_1_LIMITS.bytes);

    expect(() => validateJson1({ a: left, b: `${right}b` })).toThrow(Json1Error);
  });

  test("enforces member-name and number-token byte limits inclusively", () => {
    expect(() => decodeJson1(encode(`{"${"a".repeat(1_024)}":null}`))).not.toThrow();
    expect(() => decodeJson1(encode(`{"${"a".repeat(1_025)}":null}`))).toThrow(Json1Error);

    expect(() => decodeJson1(encode(`0.${"1".repeat(126)}`))).not.toThrow();
    expect(() => decodeJson1(encode(`0.${"1".repeat(127)}`))).toThrow(Json1Error);
  });

  test("admits negative zero but canonicalizes it as zero", () => {
    const value = decodeJson1(encode("-0"));
    expect(Object.is(value, -0)).toBeTrue();
    expect(text(canonicalJson(value))).toBe("0");
  });

  test("uses RFC 8785 member ordering and number spelling", () => {
    expect(text(canonicalJson({
      "😀": 2,
      z: 1e-7,
      a: -0,
      fraction: 0.000001,
    }))).toBe('{"a":0,"fraction":0.000001,"z":1e-7,"😀":2}');
  });

  test("rejects non-JSON host values before canonicalization", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    for (const value of [undefined, 1n, Number.NaN, Number.POSITIVE_INFINITY, cycle]) {
      expect(() => validateJson1(value)).toThrow(Json1Error);
    }
    expect(() => validateJson1({ bad: "\ud800" })).toThrow(Json1Error);
    expect(() => validateJson1([,])).toThrow(Json1Error);
  });
});

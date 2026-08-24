import { describe, expect, test } from "bun:test";

import { CheckError } from "../src/diagnostics.js";
import {
  assertNoPathCollisions,
  comparePathBytes,
  fullCaseFold15_1,
  validateLogicalPath,
} from "../src/package/paths.js";

describe("Package/1 canonical paths", () => {
  test("accepts canonical relative paths at the segment boundary", () => {
    const path = Array.from({ length: 64 }, () => "a").join("/");
    expect(validateLogicalPath(path)).toBe(path);
    expect(validateLogicalPath("skills/café/SKILL.md")).toBe("skills/café/SKILL.md");
    const byteBoundary = Array.from({ length: 4 }, () => "a".repeat(255)).join("/");
    expect(new TextEncoder().encode(byteBoundary).byteLength).toBe(1_023);
    expect(validateLogicalPath(byteBoundary)).toBe(byteBoundary);
  });

  for (const [name, path] of [
    ["empty path", ""],
    ["absolute path", "/FLOW.md"],
    ["backslash", "skills\\x"],
    ["NUL", "a\0b"],
    ["empty segment", "a//b"],
    ["dot segment", "a/./b"],
    ["parent segment", "a/../b"],
    ["non-NFC spelling", "cafe\u0301"],
    ["65 segments", Array.from({ length: 65 }, () => "a").join("/")],
    ["256-byte segment", "a".repeat(256)],
    [
      "1025-byte path",
      `${Array.from({ length: 4 }, () => "a".repeat(255)).join("/")}/a`,
    ],
    ["lone surrogate", "bad-\ud800"],
  ] as const) {
    test(`rejects ${name}`, () => {
      expectCheckError(() => validateLogicalPath(path));
    });
  }

  test("uses unsigned UTF-8 byte ordering", () => {
    expect(["é", "z", "a"].sort(comparePathBytes)).toEqual(["a", "z", "é"]);
  });

  test("uses Unicode 15.1 full default case folding", () => {
    expect(fullCaseFold15_1("Straße/Σ/ς")).toBe("strasse/σ/σ");
    for (const paths of [
      ["FLOW.md", "flow.md"],
      ["Straße/file", "STRASSE/file"],
      ["σ/file", "ς/file"],
      ["same", "same"],
    ]) {
      expectCheckError(() => assertNoPathCollisions(paths), "PACKAGE_PATH_COLLISION");
    }
  });

  test("fails closed when the host cannot prove Unicode 15.1 NFC", () => {
    const prior = Object.getOwnPropertyDescriptor(process.versions, "unicode")!;
    try {
      Object.defineProperty(process.versions, "unicode", { ...prior, value: "16.0" });
      try {
        validateLogicalPath("FLOW.md");
        throw new Error("expected Unicode-version rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CheckError);
        expect((error as CheckError).kind).toBe("unavailable");
        expect((error as CheckError).code).toBe("PACKAGE_UNICODE_UNAVAILABLE");
      }
    } finally {
      Object.defineProperty(process.versions, "unicode", prior);
    }
  });
});

function expectCheckError(action: () => unknown, code?: string): void {
  try {
    action();
    throw new Error("expected CheckError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    if (code !== undefined) expect((error as CheckError).code).toBe(code);
  }
}

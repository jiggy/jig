import { describe, expect, test } from "bun:test";

import {
  bindingRef,
  candidates,
  defineBinding,
  defineJig,
  discover,
  flowRef,
} from "../src/index.js";

describe("Jig project authoring SDK/1", () => {
  test("captures a minimal no-Binding project", () => {
    const project = defineJig({ flows: discover("./flows") });
    expect(project).toEqual({ flows: { kind: "discover", roots: ["flows"] } });
    expect(Object.isFrozen(project)).toBeTrue();
    expect(Object.isFrozen(project.flows)).toBeTrue();
  });

  test("normalizes unordered discovery and exact membership", () => {
    expect(discover(["./vendor", "./flows"])).toEqual({
      kind: "discover",
      roots: ["flows", "vendor"],
    });
    expect(defineJig({ bindings: ["./bindings/z.ts", "./bindings/a.ts"] })).toEqual({
      bindings: {
        kind: "members",
        paths: ["bindings/a.ts", "bindings/z.ts"],
      },
    });
  });

  test("captures one complete package Binding", () => {
    const binding = defineBinding({
      package: "./flows/review",
      settings: { maxRetries: 4 },
      slots: {
        research: candidates([
          bindingRef("research-deep"),
          flowRef("./flows/research-fast"),
        ]),
      },
      attachments: { source: "./workspace" },
    });

    expect(binding).toEqual({
      kind: "package",
      package: "flows/review",
      settings: { maxRetries: 4 },
      slots: {
        research: {
          kind: "candidates",
          targets: [
            { kind: "binding", id: "research-deep" },
            { kind: "flow", path: "flows/research-fast" },
          ],
        },
      },
      attachments: { source: "workspace" },
    });
    expect(Object.isFrozen(binding.settings)).toBeTrue();
    expect(Object.isFrozen(binding.slots.research)).toBeTrue();
  });

  test("uses only structural empty defaults", () => {
    expect(defineBinding({ package: "./flows/review" })).toEqual({
      kind: "package",
      package: "flows/review",
      settings: {},
      slots: {},
      attachments: {},
    });
  });

  for (const [name, action] of [
    ["unknown project field", () => defineJig({ extra: true } as never)],
    ["undefined optional", () => defineJig({ flows: undefined } as never)],
    ["glob root", () => discover("./flows/*")],
    ["escaping package", () => defineBinding({ package: "../flow" })],
    ["unknown Binding field", () => defineBinding({ package: "flows/a", grants: {} } as never)],
    ["invalid Binding reference", () => bindingRef("Not Local")],
    ["singleton candidates", () => candidates([flowRef("flows/a")])],
    ["duplicate candidates", () => candidates([flowRef("flows/a"), flowRef("./flows/a")])],
    ["non-JSON settings", () => defineBinding({ package: "flows/a", settings: { bad: 1n } as never })],
    ["class settings", () => defineBinding({ package: "flows/a", settings: new (class {})() })],
  ] as const) {
    test(`rejects ${name}`, () => expect(action).toThrow());
  }

  test("copies settings before freezing them", () => {
    const settings = { nested: { enabled: true } };
    const binding = defineBinding({ package: "flows/a", settings });
    settings.nested.enabled = false;
    expect(binding.settings).toEqual({ nested: { enabled: true } });
    expect(Object.isFrozen(binding.settings.nested)).toBeTrue();
  });

  test("preserves prototype-sensitive JSON member names", () => {
    const settings = JSON.parse('{"__proto__":{"safe":true},"constructor":"data","prototype":null}');
    const binding = defineBinding({ package: "flows/a", settings });
    expect(Object.keys(binding.settings)).toEqual(["__proto__", "constructor", "prototype"]);
    expect(Object.hasOwn(binding.settings, "__proto__")).toBeTrue();
    expect(Object.getPrototypeOf(binding.settings)).toBeNull();
    expect(binding.settings.__proto__).toEqual({ safe: true });
  });

  test("snapshots a Proxy once without trusting later reads", () => {
    let reads = 0;
    const settings = new Proxy({ value: "safe" } as Record<string, unknown>, {
      getOwnPropertyDescriptor(target, key) {
        reads += 1;
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)!;
        return { ...descriptor, value: reads === 1 ? "safe" : () => "escaped" };
      },
    });
    const binding = defineBinding({ package: "flows/a", settings: settings as never });
    expect(binding.settings).toEqual({ value: "safe" });
    expect(reads).toBe(1);
  });

  test("rejects accessors without invoking them", () => {
    let invoked = false;
    const settings = Object.defineProperty({}, "value", {
      get() { invoked = true; return "unsafe"; },
      enumerable: true,
    });
    expect(() => defineBinding({ package: "flows/a", settings })).toThrow();
    expect(invoked).toBeFalse();
  });

  test("rejects extended and accessor-backed arrays", () => {
    for (const array of [
      Object.defineProperty([1], "hidden", { value: true }),
      Object.assign([1], { [Symbol("extra")]: true }),
      Object.defineProperty([1], "0", { get: () => 1, enumerable: true }),
      new (class ExtendedArray extends Array<number> {})(1),
    ]) {
      expect(() => defineBinding({ package: "flows/a", settings: { array } })).toThrow();
    }
  });

  test("rejects the remaining non-JSON and hidden-value forms", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const hidden = Object.defineProperty({}, "value", { value: true });
    const symbol = { [Symbol("value")]: true };
    const sparse = new Array(1);
    const functionProxy = new Proxy({ value: "safe" } as Record<string, unknown>, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)!;
        return { ...descriptor, value: () => "escaped" };
      },
    });
    for (const value of [
      { value: () => true },
      hidden,
      symbol,
      { cycle },
      { value: new Date(0) },
      { value: new Map() },
      { value: new Set() },
      { value: Number.MAX_SAFE_INTEGER + 1 },
      { value: "\ud800" },
      { value: sparse },
      functionProxy,
    ]) {
      expect(() => defineBinding({ package: "flows/a", settings: value as never })).toThrow();
    }
  });

  test("allows matcher characters in exact paths but not discovery roots", () => {
    expect(defineBinding({
      package: "flows/[draft]",
      attachments: { source: "workspace/{drafts}" },
    }).attachments.source).toBe("workspace/{drafts}");
    expect(() => discover("flows/[draft]")).toThrow();
  });
});

import { describe, expect, test } from "bun:test";

import { CheckError } from "../src/diagnostics.js";
import { parseFlowDocument } from "../src/package/metadata.js";

const encoder = new TextEncoder();
const flow = (frontmatter: string, body = ""): Uint8Array =>
  encoder.encode(`---\n${frontmatter}\n---\n${body}`);

describe("FLOW.md Metadata/1", () => {
  test("accepts the minimal Run form and preserves the Markdown body", () => {
    const parsed = parseFlowDocument(flow(
      "name: gauntlet-loop\ndescription: Build and review an artifact.",
      "# Procedure\n\r\nKeep these bytes.\n",
    ));
    expect(parsed.metadata).toEqual({
      name: "gauntlet-loop",
      description: "Build and review an artifact.",
      extensions: {},
    });
    expect(parsed.markdown).toBe("# Procedure\n\r\nKeep these bytes.\n");
  });

  test("accepts the closed Service form and inert JSON-shaped extensions", () => {
    const parsed = parseFlowDocument(flow(`name: document-index
description: >-
  Maintain a document index.
service: 1
uses:
  agent:
    contract: ./contracts/agent.capability.json
  scratch:
    local: true
attachments:
  source: read
  cache: read-write
provides:
  index: ./contracts/index.capability.json
x-example:
  - null
  - true
  - 1.0
  - 2026-08-24`));

    expect(parsed.metadata).toEqual({
      name: "document-index",
      description: "Maintain a document index.",
      service: 1,
      uses: {
        agent: { contract: "./contracts/agent.capability.json" },
        scratch: { local: true },
      },
      attachments: { source: "read", cache: "read-write" },
      provides: { index: "./contracts/index.capability.json" },
      extensions: { "x-example": [null, true, 1, "2026-08-24"] },
    });
  });

  test("accepts mixed delimiter line endings and a closing delimiter at EOF", () => {
    const bytes = encoder.encode("---\r\nname: exact\ndescription: Exact.\r\n---");
    const parsed = parseFlowDocument(bytes);
    expect(parsed.metadata.name).toBe("exact");
    expect(parsed.markdown).toBe("");
  });

  for (const [name, bytes] of invalidDocuments()) {
    test(`rejects ${name}`, () => {
      expectCheckError(() => parseFlowDocument(bytes));
    });
  }

  test("counts description length in Unicode scalars", () => {
    expect(() => parseFlowDocument(flow(`name: exact\ndescription: ${"😀".repeat(16_384)}`))).not
      .toThrow();
    expectCheckError(() =>
      parseFlowDocument(flow(`name: exact\ndescription: ${"😀".repeat(16_385)}`)),
    );
  });

  test("enforces the 256-entry container bound before field semantics", () => {
    const extensions = Array.from({ length: 254 }, (_, index) => `x-k${index}: null`).join("\n");
    expect(() => parseFlowDocument(flow(`name: exact\ndescription: Exact.\n${extensions}`))).not
      .toThrow();
    expectCheckError(() =>
      parseFlowDocument(
        flow(`name: exact\ndescription: Exact.\n${extensions}\nx-overflow: null\nx-overflow-two: null`),
      ),
      "METADATA_LIMIT",
    );
  });

  test("bounds the LocalName suffix of extension keys", () => {
    const maximum = `x-${"a".repeat(64)}`;
    const parsed = parseFlowDocument(flow(
      `name: exact\ndescription: Exact.\n${maximum}: true`,
    ));
    expect(parsed.metadata.extensions[maximum]).toBe(true);

    expectCheckError(
      () => parseFlowDocument(flow(
        `name: exact\ndescription: Exact.\nx-${"a".repeat(65)}: true`,
      )),
      "METADATA_FIELD",
    );
  });

  test("enforces frontmatter bytes, depth, and total nodes inclusively", () => {
    expect(() => parseFlowDocument(paddedDocument(262_144))).not.toThrow();
    expectCheckError(() => parseFlowDocument(paddedDocument(262_145)));

    expect(() => parseFlowDocument(flow(
      `name: exact\ndescription: Exact.\nx-data: ${"[".repeat(14)}null${"]".repeat(14)}`,
    ))).not.toThrow();
    expectCheckError(() => parseFlowDocument(flow(
      `name: exact\ndescription: Exact.\nx-data: ${"[".repeat(15)}null${"]".repeat(15)}`,
    )));

    expect(() => parseFlowDocument(flow(metadataWithNodeCount(4_096)))).not.toThrow();
    expectCheckError(() => parseFlowDocument(flow(metadataWithNodeCount(4_097))));
  });
});

function paddedDocument(bytesThroughClosingDelimiter: number): Uint8Array {
  const before = "---\nname: exact\ndescription: Exact.\nx-padding: \"";
  const after = "\"\n---\n";
  const padding = bytesThroughClosingDelimiter - encoder.encode(before).byteLength -
    encoder.encode(after).byteLength;
  if (padding < 0) throw new Error("invalid test padding");
  return encoder.encode(`${before}${"a".repeat(padding)}${after}`);
}

function metadataWithNodeCount(nodes: 4_096 | 4_097): string {
  // Root + three key/value pairs contribute seven nodes. The outer sequence
  // has 256 child sequences; the first 255 contribute sixteen nodes each.
  const finalItems = nodes - 4_088;
  const full = `[${Array.from({ length: 15 }, () => "null").join(",")}]`;
  const last = `[${Array.from({ length: finalItems }, () => "null").join(",")}]`;
  return `name: exact\ndescription: Exact.\nx-data: [${[
    ...Array.from({ length: 255 }, () => full),
    last,
  ].join(",")}]`;
}

function invalidDocuments(): Array<readonly [string, Uint8Array]> {
  const minimal = "name: exact\ndescription: Exact.";
  return [
    ["UTF-8 BOM", Uint8Array.from([0xef, 0xbb, 0xbf, ...flow(minimal)])],
    ["invalid UTF-8 in the Markdown body", Uint8Array.from([...flow(minimal), 0xff])],
    ["a missing opening delimiter", encoder.encode(`${minimal}\n---\n`)],
    ["an inexact opening delimiter", encoder.encode(`--- \n${minimal}\n---\n`)],
    ["a missing closing delimiter", encoder.encode(`---\n${minimal}\n`) ],
    ["an inexact closing delimiter", encoder.encode(`---\n${minimal}\n--- \n`) ],
    ["a duplicate key", flow("name: exact\nname: other\ndescription: Exact.")],
    ["an anchor", flow("name: &name exact\ndescription: Exact.")],
    ["an alias", flow("name: exact\ndescription: &text Exact.\nx-copy: *text")],
    ["an explicit tag", flow("name: exact\ndescription: !!str Exact.")],
    ["a non-string mapping key", flow("name: exact\ndescription: Exact.\n? [bad]\n: value")],
    ["flow: 1", flow(`${minimal}\nflow: 1`)],
    ["a format discriminator", flow(`${minimal}\nformat: 2`)],
    ["an unknown unnamespaced field", flow(`${minimal}\nunknown: true`)],
    ["an invalid extension key", flow(`${minimal}\nx-Bad: true`)],
    ["a Run package providing a capability", flow(`${minimal}\nprovides:\n  index: ./index.json`)],
    ["a Service package with a Run fallback", flow(`${minimal}\nservice: 1\nfallback: instruction`)],
    ["a reserved outcome", flow(`${minimal}\noutcomes:\n  done: No.`)],
    ["an unsafe JSON/1 number", flow(`${minimal}\nx-number: 9007199254740993`)],
    ["an escaping author reference", flow(`${minimal}\nuses:\n  agent:\n    contract: ../agent.json`)],
    ["an ambiguous capability use", flow(`${minimal}\nuses:\n  agent:\n    contract: ./agent.json\n    local: true`)],
  ];
}

function expectCheckError(action: () => unknown, code?: string): void {
  try {
    action();
    throw new Error("expected CheckError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    if (code !== undefined) expect((error as CheckError).code).toBe(code);
  }
}

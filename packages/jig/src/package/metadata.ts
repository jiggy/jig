import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Node,
  type Pair,
  type Scalar,
} from "yaml";

import { invalid } from "../diagnostics.js";
import { Json1Error, validateJson1, type JsonObject, type JsonValue } from "../json.js";
import { isNfc15_1 } from "./paths.js";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();
const LOCAL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JSON_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const RESERVED_OUTCOMES = new Set(["done", "failed", "cancelled", "error"]);

export interface CapabilityUse {
  readonly contract?: string;
  readonly local?: true;
}

export interface FlowMetadata {
  readonly name: string;
  readonly description: string;
  readonly uses?: Readonly<Record<string, CapabilityUse>>;
  readonly outcomes?: Readonly<Record<string, string>>;
  readonly attachments?: Readonly<Record<string, "read" | "read-write">>;
  readonly extensions: JsonObject;
}

export interface ParsedFlowDocument {
  readonly metadata: FlowMetadata;
  readonly markdown: string;
}

export interface ParsedFlowMetadataPrefix {
  readonly metadata: FlowMetadata;
  readonly bodyOffset: number;
}

export function parseFlowDocument(bytes: Uint8Array): ParsedFlowDocument {
  // A complete in-memory document parser is useful for fixtures and small
  // packages. Admission uses parseFlowMetadataPrefix plus streaming UTF-8
  // validation so a large Markdown body is never buffered as one string.
  try {
    decoder.decode(bytes);
  } catch {
    invalid("METADATA_INVALID_UTF8", "FLOW.md is not valid UTF-8", "FLOW.md");
  }
  const parsed = parseFlowMetadataPrefix(bytes);
  return {
    metadata: parsed.metadata,
    markdown: decoder.decode(bytes.subarray(parsed.bodyOffset)),
  };
}

export function parseFlowMetadataPrefix(bytes: Uint8Array): ParsedFlowMetadataPrefix {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    invalid("METADATA_BOM", "FLOW.md must not begin with a UTF-8 BOM", "FLOW.md");
  }
  const opening = openingLength(bytes);
  if (opening === 0) {
    invalid("METADATA_DELIMITER", "FLOW.md must begin with an exact --- delimiter line", "FLOW.md");
  }
  const closing = findClosingDelimiter(bytes, opening);
  if (closing === undefined) {
    if (bytes.byteLength > 262_144) {
      invalid("METADATA_LIMIT", "FLOW.md frontmatter exceeds 262144 bytes", "FLOW.md");
    }
    invalid("METADATA_DELIMITER", "FLOW.md has no exact closing --- delimiter line", "FLOW.md");
  }
  if (closing.end > 262_144) {
    invalid("METADATA_LIMIT", "FLOW.md frontmatter exceeds 262144 bytes", "FLOW.md");
  }

  let source: string;
  try {
    source = decoder.decode(bytes.subarray(opening, closing.start));
  } catch {
    invalid("METADATA_INVALID_UTF8", "FLOW.md frontmatter is not valid UTF-8", "FLOW.md");
  }
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: false,
    schema: "failsafe",
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    const problem = document.errors[0] ?? document.warnings[0]!;
    invalid("METADATA_INVALID_YAML", problem.message, "FLOW.md");
  }
  const declaredTags = Object.keys(document.directives.tags).filter((tag) => tag !== "!!");
  if (declaredTags.length > 0) {
    invalid("METADATA_YAML_FEATURE", "YAML tag directives are not allowed", "FLOW.md");
  }
  const root = convertNode(document.contents as Node | null, 1, { nodes: 0 }, true);
  if (!isObject(root)) {
    invalid("METADATA_ROOT", "FLOW.md frontmatter must be a mapping", "FLOW.md");
  }
  try {
    validateJson1(root);
  } catch (error) {
    if (error instanceof Json1Error) {
      invalid("METADATA_JSON_VALUE", error.message, "FLOW.md");
    }
    throw error;
  }
  const metadata = validateMetadata(root);
  return { metadata, bodyOffset: closing.end };
}

function openingLength(bytes: Uint8Array): number {
  if (bytes[0] !== 0x2d || bytes[1] !== 0x2d || bytes[2] !== 0x2d) return 0;
  if (bytes[3] === 0x0a) return 4;
  if (bytes[3] === 0x0d && bytes[4] === 0x0a) return 5;
  return 0;
}

function findClosingDelimiter(
  bytes: Uint8Array,
  start: number,
): { readonly start: number; readonly end: number } | undefined {
  let lineStart = start;
  for (let position = start; position <= bytes.byteLength; position += 1) {
    if (position !== bytes.byteLength && bytes[position] !== 0x0a) continue;
    const rawEnd = position;
    const lineEnd = rawEnd > lineStart && bytes[rawEnd - 1] === 0x0d
      ? rawEnd - 1
      : rawEnd;
    if (
      lineEnd - lineStart === 3 &&
      bytes[lineStart] === 0x2d &&
      bytes[lineStart + 1] === 0x2d &&
      bytes[lineStart + 2] === 0x2d
    ) {
      return { start: lineStart, end: position < bytes.byteLength ? position + 1 : position };
    }
    lineStart = position + 1;
  }
  return undefined;
}

interface MetadataLimitState {
  nodes: number;
}

function convertNode(
  node: Node | null,
  depth: number,
  state: MetadataLimitState,
  root = false,
): JsonValue {
  if (node === null) invalid("METADATA_INVALID_YAML", "empty YAML nodes are not allowed", "FLOW.md");
  if (depth > 16) invalid("METADATA_LIMIT", "frontmatter exceeds depth 16", "FLOW.md");
  state.nodes += 1;
  if (state.nodes > 4_096) invalid("METADATA_LIMIT", "frontmatter exceeds 4096 nodes", "FLOW.md");
  if (isAlias(node)) invalid("METADATA_YAML_FEATURE", "YAML aliases are not allowed", "FLOW.md");
  if (node.anchor !== undefined) invalid("METADATA_YAML_FEATURE", "YAML anchors are not allowed", "FLOW.md");
  if (node.tag !== undefined) invalid("METADATA_YAML_FEATURE", "explicit YAML tags are not allowed", "FLOW.md");

  if (isScalar(node)) return convertScalar(node);
  if (isSeq(node)) {
    if (node.items.length > 256) invalid("METADATA_LIMIT", "a YAML sequence exceeds 256 entries", "FLOW.md");
    return node.items.map((child) => convertNode(child as Node | null, depth + 1, state));
  }
  if (isMap(node)) {
    if (node.items.length > 256) invalid("METADATA_LIMIT", "a YAML mapping exceeds 256 entries", "FLOW.md");
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const pair of node.items as Pair[]) {
      const keyValue = convertNode(pair.key as Node | null, depth + 1, state);
      if (typeof keyValue !== "string") {
        invalid("METADATA_YAML_KEY", "YAML mapping keys must resolve to strings", "FLOW.md");
      }
      if (keyValue === "<<") invalid("METADATA_YAML_FEATURE", "YAML merge keys are not allowed", "FLOW.md");
      if (Object.hasOwn(result, keyValue)) invalid("METADATA_DUPLICATE_KEY", `duplicate key ${keyValue}`, "FLOW.md");
      result[keyValue] = convertNode(pair.value as Node | null, depth + 1, state);
    }
    if (root && state.nodes < 1) invalid("METADATA_ROOT", "invalid metadata root", "FLOW.md");
    return result;
  }
  return invalid("METADATA_YAML_FEATURE", "unsupported YAML node", "FLOW.md");
}

function convertScalar(node: Scalar): JsonValue {
  const source = node.source ?? "";
  if (node.type !== "PLAIN") return String(node.value ?? "");
  if (source === "null") return null;
  if (source === "true") return true;
  if (source === "false") return false;
  if (JSON_NUMBER.test(source)) {
    if (encoder.encode(source).byteLength > 128) {
      invalid("METADATA_NUMBER", "frontmatter number token exceeds 128 bytes", "FLOW.md");
    }
    const value = Number(source);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      invalid("METADATA_NUMBER", "frontmatter number is outside FLOW JSON/1", "FLOW.md");
    }
    return value;
  }
  return source;
}

function validateMetadata(root: JsonObject): FlowMetadata {
  const known = new Set([
    "name",
    "description",
    "uses",
    "outcomes",
    "attachments",
  ]);
  const extensions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of Object.entries(root)) {
    if (known.has(key)) continue;
    if (key.startsWith("x-") && isLocalName(key.slice(2))) extensions[key] = value;
    else invalid(
      "METADATA_FIELD",
      `unknown Metadata/1 field ${key}`,
      "FLOW.md",
      `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
    );
  }
  const name = requireLocalName(root.name, "name");
  const description = requireDescription(root.description, "description");
  const uses = root.uses === undefined ? undefined : validateUses(root.uses);
  const outcomes = root.outcomes === undefined ? undefined : validateDescriptions(root.outcomes, true);
  const attachments = root.attachments === undefined ? undefined : validateAttachments(root.attachments);

  const metadata: FlowMetadata = {
    name,
    description,
    ...(uses === undefined ? {} : { uses }),
    ...(outcomes === undefined ? {} : { outcomes }),
    ...(attachments === undefined ? {} : { attachments }),
    extensions,
  };
  deepFreezeJson(metadata as unknown as JsonValue);
  return metadata;
}

function validateUses(value: JsonValue): Readonly<Record<string, CapabilityUse>> {
  const object = requireObject(value, "uses");
  const result: Record<string, CapabilityUse> = Object.create(null) as Record<string, CapabilityUse>;
  for (const [slot, declaration] of Object.entries(object)) {
    requireLocalName(slot, `uses.${slot}`);
    const item = requireObject(declaration, `uses.${slot}`);
    if (Object.keys(item).length !== 1) invalid("METADATA_USES", `uses.${slot} must have one member`, "FLOW.md");
    if (typeof item.contract === "string") {
      result[slot] = { contract: requireAuthorReference(item.contract, `uses.${slot}.contract`) };
    } else if (item.local === true) {
      result[slot] = { local: true };
    } else {
      invalid("METADATA_USES", `uses.${slot} must declare contract or local: true`, "FLOW.md");
    }
  }
  return result;
}

function validateDescriptions(value: JsonValue, outcomes: boolean): Readonly<Record<string, string>> {
  const object = requireObject(value, outcomes ? "outcomes" : "descriptions");
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, description] of Object.entries(object)) {
    requireLocalName(name, `outcomes.${name}`);
    if (outcomes && RESERVED_OUTCOMES.has(name)) {
      invalid("METADATA_OUTCOME", `outcome ${name} is reserved`, "FLOW.md");
    }
    result[name] = requireDescription(description, `outcomes.${name}`);
  }
  return result;
}

function validateAttachments(value: JsonValue): Readonly<Record<string, "read" | "read-write">> {
  const object = requireObject(value, "attachments");
  const result: Record<string, "read" | "read-write"> = Object.create(null) as Record<string, "read" | "read-write">;
  for (const [name, access] of Object.entries(object)) {
    requireLocalName(name, `attachments.${name}`);
    if (access !== "read" && access !== "read-write") {
      invalid("METADATA_ATTACHMENT", `attachments.${name} must be read or read-write`, "FLOW.md");
    }
    result[name] = access;
  }
  return result;
}

export function requireAuthorReference(value: string, field: string): string {
  if (!value.startsWith("./") || value.length <= 2) {
    invalid("METADATA_REFERENCE", `${field} must begin with ./`, "FLOW.md");
  }
  const path = value.slice(2);
  if (!isCanonicalLogicalPath(path)) {
    invalid("METADATA_REFERENCE", `${field} is not a canonical package reference`, "FLOW.md");
  }
  return value;
}

function requireLocalName(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || !isLocalName(value)) {
    invalid("METADATA_LOCAL_NAME", `${field} must be a Metadata/1 LocalName`, "FLOW.md");
  }
  return value;
}

function isLocalName(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && LOCAL_NAME.test(value);
}

function requireDescription(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") invalid("METADATA_DESCRIPTION", `${field} must be text`, "FLOW.md");
  const length = Array.from(value).length;
  if (length < 1 || length > 16_384) {
    invalid("METADATA_DESCRIPTION", `${field} must contain 1-16384 Unicode scalars`, "FLOW.md");
  }
  return value;
}

function requireObject(value: JsonValue, field: string): JsonObject {
  if (!isObject(value)) invalid("METADATA_FIELD", `${field} must be a mapping`, "FLOW.md");
  return value;
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreezeJson(value: JsonValue): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreezeJson(child);
  Object.freeze(value);
}

function isCanonicalLogicalPath(path: string): boolean {
  if (path.includes("\\") || path.includes("\0")) return false;
  if (!isNfc15_1(path)) return false;
  const segments = path.split("/");
  if (segments.length === 0 || segments.length > 64) return false;
  if (encoder.encode(path).byteLength > 1_024) return false;
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    encoder.encode(segment).byteLength <= 255
  );
}

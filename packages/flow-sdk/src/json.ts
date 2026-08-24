import type { JsonValue } from "./types.ts";

export const MAX_FRAME_BYTES = 16_777_216;
const MAX_DEPTH = 128;
const MAX_NODES = 262_144;
const MAX_CONTAINER_ENTRIES = 65_536;
const MAX_STRING_BYTES = 8_388_608;
const MAX_MEMBER_NAME_BYTES = 1_024;
const MAX_NUMBER_TOKEN_BYTES = 128;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class JsonViolation extends Error {
  readonly reportable: boolean;

  constructor(message: string, reportable = true) {
    super(message);
    this.name = "JsonViolation";
    this.reportable = reportable;
  }
}

class Parser {
  private position = 0;
  private nodes = 0;

  constructor(private readonly source: string) {}

  parse(): JsonValue {
    this.skipWhitespace();
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.position !== this.source.length) {
      throw this.error("unexpected trailing characters");
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > MAX_DEPTH) throw this.error("maximum value depth exceeded");
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw this.error("maximum value nodes exceeded");

    const char = this.source[this.position];
    if (char === '"') return this.parseString(false);
    if (char === "{") return this.parseObject(depth);
    if (char === "[") return this.parseArray(depth);
    if (char === "t") return this.parseLiteral("true", true);
    if (char === "f") return this.parseLiteral("false", false);
    if (char === "n") return this.parseLiteral("null", null);
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      return this.parseNumber();
    }
    throw this.error("expected a JSON value");
  }

  private parseObject(depth: number): JsonValue {
    this.position += 1;
    const value: Record<string, JsonValue> = Object.create(null) as Record<
      string,
      JsonValue
    >;
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.consume("}")) return value;

    let members = 0;
    while (true) {
      if (this.source[this.position] !== '"') {
        throw this.error("expected an object member name");
      }
      const key = this.parseString(true);
      if (keys.has(key)) throw this.error(`duplicate object member ${key}`);
      keys.add(key);
      members += 1;
      if (members > MAX_CONTAINER_ENTRIES) {
        throw this.error("maximum object members exceeded");
      }

      this.skipWhitespace();
      if (!this.consume(":")) throw this.error("expected ':' after member name");
      this.skipWhitespace();
      value[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      if (this.consume("}")) return value;
      if (!this.consume(",")) throw this.error("expected ',' or '}'");
      this.skipWhitespace();
    }
  }

  private parseArray(depth: number): JsonValue {
    this.position += 1;
    const value: JsonValue[] = [];
    this.skipWhitespace();
    if (this.consume("]")) return value;

    while (true) {
      if (value.length >= MAX_CONTAINER_ENTRIES) {
        throw this.error("maximum array items exceeded");
      }
      value.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      if (this.consume("]")) return value;
      if (!this.consume(",")) throw this.error("expected ',' or ']'");
      this.skipWhitespace();
    }
  }

  private parseString(memberName: boolean): string {
    this.position += 1;
    const parts: string[] = [];
    let segmentStart = this.position;
    while (this.position < this.source.length) {
      const char = this.source[this.position];
      this.position += 1;
      if (char === '"') {
        parts.push(this.source.slice(segmentStart, this.position - 1));
        const value = parts.join("");
        const size = encoder.encode(value).byteLength;
        const limit = memberName ? MAX_MEMBER_NAME_BYTES : MAX_STRING_BYTES;
        if (size > limit) throw this.error("maximum string bytes exceeded");
        return value;
      }
      if (char === "\\") {
        parts.push(this.source.slice(segmentStart, this.position - 1));
        parts.push(this.parseEscape());
        segmentStart = this.position;
        continue;
      }
      if (char === undefined || char.charCodeAt(0) <= 0x1f) {
        throw this.error("invalid character in string");
      }
      const code = char.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdfff) {
        const next = this.source[this.position];
        if (
          code > 0xdbff ||
          next === undefined ||
          next.charCodeAt(0) < 0xdc00 ||
          next.charCodeAt(0) > 0xdfff
        ) {
          throw this.error("lone Unicode surrogate");
        }
        this.position += 1;
      }
    }
    throw this.error("unterminated string");
  }

  private parseEscape(): string {
    const escape = this.source[this.position];
    this.position += 1;
    switch (escape) {
      case '"':
      case "\\":
      case "/":
        return escape;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u": {
        const first = this.parseHexCodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.source.slice(this.position, this.position + 2) !== "\\u") {
            throw this.error("high surrogate without low surrogate");
          }
          this.position += 2;
          const second = this.parseHexCodeUnit();
          if (second < 0xdc00 || second > 0xdfff) {
            throw this.error("high surrogate without low surrogate");
          }
          return String.fromCharCode(first, second);
        }
        if (first >= 0xdc00 && first <= 0xdfff) {
          throw this.error("lone low surrogate");
        }
        return String.fromCharCode(first);
      }
      default:
        throw this.error("invalid string escape");
    }
  }

  private parseHexCodeUnit(): number {
    const token = this.source.slice(this.position, this.position + 4);
    if (!/^[0-9A-Fa-f]{4}$/.test(token)) {
      throw this.error("invalid Unicode escape");
    }
    this.position += 4;
    return Number.parseInt(token, 16);
  }

  private parseNumber(): number {
    const start = this.position;
    this.consume("-");

    if (this.consume("0")) {
      const next = this.source[this.position];
      if (next !== undefined && next >= "0" && next <= "9") {
        throw this.error("leading zero in number");
      }
    } else {
      if (!this.consumeDigit("1", "9")) throw this.error("invalid number");
      while (this.consumeDigit("0", "9")) {}
    }

    if (this.consume(".")) {
      if (!this.consumeDigit("0", "9")) {
        throw this.error("fraction requires a digit");
      }
      while (this.consumeDigit("0", "9")) {}
    }

    const exponent = this.source[this.position];
    if (exponent === "e" || exponent === "E") {
      this.position += 1;
      const sign = this.source[this.position];
      if (sign === "+" || sign === "-") this.position += 1;
      if (!this.consumeDigit("0", "9")) {
        throw this.error("exponent requires a digit");
      }
      while (this.consumeDigit("0", "9")) {}
    }

    const token = this.source.slice(start, this.position);
    if (token.length > MAX_NUMBER_TOKEN_BYTES) {
      throw this.error("maximum number token bytes exceeded");
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw this.error("non-finite number");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw this.error("integral number outside safe range");
    }
    return value;
  }

  private parseLiteral<T extends JsonValue>(token: string, value: T): T {
    if (this.source.slice(this.position, this.position + token.length) !== token) {
      throw this.error(`invalid literal ${token}`);
    }
    this.position += token.length;
    return value;
  }

  private consume(expected: string): boolean {
    if (this.source[this.position] !== expected) return false;
    this.position += 1;
    return true;
  }

  private consumeDigit(minimum: string, maximum: string): boolean {
    const char = this.source[this.position];
    if (char === undefined || char < minimum || char > maximum) return false;
    this.position += 1;
    return true;
  }

  private skipWhitespace(): void {
    while (true) {
      const char = this.source[this.position];
      if (char !== " " && char !== "\n" && char !== "\r" && char !== "\t") return;
      this.position += 1;
    }
  }

  private error(message: string): JsonViolation {
    return new JsonViolation(`${message} at character ${this.position}`);
  }
}

export function decodeJson(bytes: Uint8Array): JsonValue {
  if (bytes.byteLength === 0) throw new JsonViolation("empty frame");
  if (bytes.byteLength > MAX_FRAME_BYTES) {
    throw new JsonViolation("maximum frame bytes exceeded");
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JsonViolation("UTF-8 BOM is not allowed");
  }
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new JsonViolation("invalid UTF-8", false);
  }
  return new Parser(text).parse();
}

interface ValidationState {
  nodes: number;
  active: WeakSet<object>;
}

export function encodeJson(value: JsonValue): Uint8Array {
  validateValue(value, 1, { nodes: 0, active: new WeakSet<object>() }, false);
  const encoded = encoder.encode(JSON.stringify(value));
  if (encoded.byteLength > MAX_FRAME_BYTES) {
    throw new JsonViolation("maximum frame bytes exceeded");
  }
  return encoded;
}

function validateValue(
  value: unknown,
  depth: number,
  state: ValidationState,
  memberName: boolean,
): void {
  if (depth > MAX_DEPTH) throw new JsonViolation("maximum value depth exceeded");
  state.nodes += 1;
  if (state.nodes > MAX_NODES) throw new JsonViolation("maximum value nodes exceeded");

  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new JsonViolation("non-finite number");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new JsonViolation("integral number outside safe range");
    }
    return;
  }
  if (typeof value === "string") {
    validateString(value, memberName ? MAX_MEMBER_NAME_BYTES : MAX_STRING_BYTES);
    return;
  }
  if (typeof value !== "object") throw new JsonViolation("value is not JSON/1");

  const object = value as object;
  if (state.active.has(object)) throw new JsonViolation("cyclic value");
  state.active.add(object);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_CONTAINER_ENTRIES) {
        throw new JsonViolation("maximum array items exceeded");
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) {
          throw new JsonViolation("arrays require dense data properties");
        }
        validateValue(descriptor.value, depth + 1, state, false);
      }
      const ownKeys = Reflect.ownKeys(value);
      if (
        ownKeys.some((key) => {
          if (key === "length") return false;
          if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key)) return true;
          const index = Number(key);
          return !Number.isSafeInteger(index) || index < 0 || index >= value.length;
        })
      ) {
        throw new JsonViolation("array has non-index properties");
      }
      return;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new JsonViolation("JSON object must be a plain object");
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_CONTAINER_ENTRIES) {
      throw new JsonViolation("maximum object members exceeded");
    }
    for (const key of keys) {
      if (typeof key !== "string") throw new JsonViolation("symbol object member");
      validateString(key, MAX_MEMBER_NAME_BYTES);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new JsonViolation("object members must be enumerable data properties");
      }
      validateValue(descriptor.value, depth + 1, state, false);
    }
  } finally {
    state.active.delete(object);
  }
}

function validateString(value: string, maximumBytes: number): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new JsonViolation("lone Unicode surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new JsonViolation("lone Unicode surrogate");
    }
  }
  if (encoder.encode(value).byteLength > maximumBytes) {
    throw new JsonViolation("maximum string bytes exceeded");
  }
}

import type { JsonObject, JsonValue } from "../json.js";

export const SCHEMA_1_URI = "https://flow.dev/schemas/schema-1.json";

export const SCHEMA_1_LIMITS = Object.freeze({
  bytes: 262_144,
  depth: 64,
  nodes: 4_096,
  work: 1_000_000,
});

export type SchemaValue = boolean | JsonObject;

export type SchemaCompilationCode =
  | "SCHEMA_INVALID_JSON"
  | "SCHEMA_INVALID"
  | "SCHEMA_KEYWORD_UNSUPPORTED"
  | "SCHEMA_REFERENCE_INVALID"
  | "SCHEMA_LIMIT_EXCEEDED";

export interface SchemaDiagnosticShape {
  readonly code: string;
  readonly instancePointer: string;
  readonly schemaPointer: string;
  readonly keyword?: string;
  readonly path: string;
}

export class SchemaDiagnostic extends Error implements SchemaDiagnosticShape {
  readonly code: string;
  readonly instancePointer: string;
  readonly schemaPointer: string;
  readonly keyword?: string;
  readonly path: string;

  constructor(
    message: string,
    diagnostic: SchemaDiagnosticShape,
  ) {
    super(message);
    this.name = "SchemaDiagnostic";
    this.code = diagnostic.code;
    this.instancePointer = diagnostic.instancePointer;
    this.schemaPointer = diagnostic.schemaPointer;
    this.path = diagnostic.path;
    if (diagnostic.keyword !== undefined) this.keyword = diagnostic.keyword;
  }
}

export interface CompiledSchema {
  readonly path: string;
  readonly schemaPointer: string;

  /** Validate one bounded FLOW JSON/1 value without changing it. */
  validate(instance: unknown, code: string): void;
}

export interface EmbeddedSchemaSource {
  /** RFC 6901 pointer from the containing descriptor root. */
  readonly pointer: string;
  readonly schema: JsonValue;
}

export interface EmbeddedSchemaOptions {
  readonly path: string;
  /** Descriptor-root definitions addressed by `#/$defs/<name>`. */
  readonly rootDefs?: JsonObject;
}

export interface SingleEmbeddedSchemaOptions extends EmbeddedSchemaOptions {
  readonly pointer?: string;
}

// DESIGN PROBE ONLY.
// Tiny language-SDK projection of FLOW Service/1; no implementation exists.

declare const Deno: {
  readonly errors: {
    readonly NotFound: new (...arguments_: never[]) => Error;
  };
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
};

declare module "@flow/service" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export interface Attachment {
    readonly path: string;
    readonly mode: "read" | "read-write";
    resolve(relativePath: string): string;
  }

  export interface ServiceMount {
    readonly signal: AbortSignal;
    attachment(name: string): Attachment;
    provide(
      name: string,
      methods: Readonly<
        Record<string, (input: JsonValue) => Promise<JsonValue>>
      >,
    ): void;
    ready(exports: readonly string[]): Promise<void>;
  }

  export function capabilityError(
    name: string,
    data: JsonValue,
  ): Error;

  export function serveService(
    handler: (mount: ServiceMount) => Promise<void>,
  ): void;
}

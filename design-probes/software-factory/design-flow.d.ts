// DESIGN PROBE ONLY.
// Tiny language-SDK projection of FLOW Service/1; no implementation exists.

declare namespace Deno {
  interface FileInfo {
    readonly isFile: boolean;
    readonly size: number;
    readonly mtime: Date | null;
  }
}

declare const Deno: {
  readonly errors: {
    readonly NotFound: new (...arguments_: never[]) => Error;
    readonly IsADirectory: new (...arguments_: never[]) => Error;
  };
  readFile(path: string): Promise<Uint8Array>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  stat(path: string): Promise<Deno.FileInfo>;
  readDir(path: string): AsyncIterable<{
    readonly name: string;
    readonly isFile: boolean;
  }>;
  watchFs(path: string): AsyncIterable<{
    readonly paths: readonly string[];
  }> & { close(): void };
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
    relative(absolutePath: string): string | undefined;
  }

  export interface ServiceMount {
    readonly signal: AbortSignal;
    attachment(name: string): Attachment;
    readonly effects: {
      call<Result extends JsonValue>(request: {
        readonly operationId: string;
        readonly slot: string;
        readonly method: string;
        readonly input: JsonValue;
      }): Promise<Result>;
    };
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

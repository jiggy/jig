// DESIGN PROBE ONLY.
// Tiny language-SDK projection of FLOW Run/1; no implementation exists.

declare const Deno: {
  readTextFile(path: string): Promise<string>;
};

declare module "@flow/run" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export type DeepReadonly<T> =
    T extends (...args: never[]) => unknown
      ? T
      : T extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
          : T;

  export interface Attachment {
    readonly path: string;
    readonly mode: "read" | "read-write";
    resolve(relativePath: string): string;
  }

  export interface Run<Input, Settings> {
    readonly input: DeepReadonly<Input>;
    readonly settings: DeepReadonly<Settings>;
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
    readonly flows: {
      call(request: {
        readonly operationId: string;
        readonly slot: string;
        readonly intent?: string;
        readonly input: JsonValue;
      }): Promise<{
        readonly outcome: string;
        readonly output: JsonValue;
      }>;
    };
  }

  export function serve<Input, Settings>(
    handler: (
      run: Run<Input, Settings>,
    ) => Promise<{
      readonly outcome: string;
      readonly output: JsonValue;
    }>,
  ): void;
}

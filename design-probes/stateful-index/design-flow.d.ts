// DESIGN PROBE ONLY: minimal Run/1 and Service/1 SDK projections.
declare module "@flow/run" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export interface EffectRequest {
    readonly operationId: string;
    readonly slot: string;
    readonly method: string;
    readonly input: JsonValue;
  }

  export interface Run<Input> {
    readonly input: Readonly<Input>;
    readonly signal: AbortSignal;
    readonly effects: {
      call<Result extends JsonValue>(request: EffectRequest): Promise<Result>;
    };
  }

  export function serve<Input>(
    handler: (
      run: Run<Input>,
    ) => Promise<{ readonly outcome: string; readonly output: JsonValue }>,
  ): void;
}

declare module "@flow/service" {
  export type JsonValue = import("@flow/run").JsonValue;

  export interface EffectClient {
    call<Result extends JsonValue>(request: {
      readonly operationId: string;
      readonly slot: string;
      readonly method: string;
      readonly input: JsonValue;
    }): Promise<Result>;
  }

  export interface ServiceInvocation {
    readonly signal: AbortSignal;
    readonly effects: EffectClient;
  }

  export interface Attachment {
    readonly path: string;
    readonly mode: "read" | "read-write";
    resolve(relativePath: string): string;
  }

  export interface ServiceMount {
    readonly signal: AbortSignal;
    readonly effects: EffectClient;
    attachment(name: string): Attachment;
    provide(
      name: string,
      methods: Readonly<
        Record<
          string,
          (
            input: JsonValue,
            invocation: ServiceInvocation,
          ) => Promise<JsonValue>
        >
      >,
    ): void;
    ready(exports: readonly string[]): Promise<void>;
  }

  export function capabilityError(name: string, data: JsonValue): Error;
  export function serveService(
    handler: (mount: ServiceMount) => Promise<void>,
  ): void;
}

declare module "node:fs/promises" {
  export function mkdir(
    path: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
}

declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
  write(path: string, data: string): Promise<number>;
};

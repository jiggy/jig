// DESIGN PROBES ONLY.
// One candidate TypeScript projection of FLOW Run/1 and Service/1 shared by
// every probe. It is deliberately a subset, not a published SDK commitment.

declare module "@flowmd/sdk" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export type DeepReadonly<Value> =
    Value extends (...arguments_: never[]) => unknown
      ? Value
      : Value extends readonly (infer Item)[]
        ? readonly DeepReadonly<Item>[]
        : Value extends object
          ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
          : Value;

  export type MaybePromise<Value> = Value | Promise<Value>;

  export interface EffectClient {
    call<Result extends JsonValue>(request: {
      readonly operationId: string;
      readonly slot: string;
      readonly method: string;
      readonly input: JsonValue;
    }): Promise<Result>;
  }

  export interface FlowClient {
    call(request: {
      readonly operationId: string;
      readonly slot: string;
      readonly intent?: string;
      readonly input: JsonValue;
    }): Promise<RunResult>;
  }

  export interface Attachment {
    readonly path: string;
    readonly mode: "read" | "read-write";
    resolve(relativePath: string): string;
  }

  export interface RunContext<Input, Settings = Record<string, never>> {
    readonly input: DeepReadonly<Input>;
    readonly settings: DeepReadonly<Settings>;
    readonly signal: AbortSignal;
    readonly effects: EffectClient;
    readonly flows: FlowClient;
    attachment(name: string): Attachment;
  }

  export interface RunResult<Output extends JsonValue = JsonValue> {
    readonly outcome: string;
    readonly output: Output;
  }

  export function serveRun<
    Input,
    Settings = Record<string, never>,
    Output extends JsonValue = JsonValue,
  >(
    handler: (
      run: RunContext<Input, Settings>,
    ) => MaybePromise<RunResult<Output>>,
  ): void;

  export interface ServiceInvocation {
    readonly signal: AbortSignal;
    readonly effects: EffectClient;
    readonly flows: FlowClient;
  }

  export type ServiceMethod = (
    input: JsonValue,
    invocation: ServiceInvocation,
  ) => MaybePromise<JsonValue>;

  export interface ServiceContext<
    Settings = Record<string, never>,
  > {
    readonly settings: DeepReadonly<Settings>;
    readonly signal: AbortSignal;
    readonly effects: EffectClient;
    readonly flows: FlowClient;
    attachment(name: string): Attachment;
  }

  export interface ServiceDefinition {
    readonly exports: Readonly<
      Record<string, Readonly<Record<string, ServiceMethod>>>
    >;
    readonly dispose?: () => MaybePromise<void>;
  }

  export function serveService<
    Settings = Record<string, never>,
  >(
    setup: (
      mount: ServiceContext<Settings>,
    ) => MaybePromise<ServiceDefinition>,
  ): void;

  export function capabilityError(name: string, data: JsonValue): Error;
}

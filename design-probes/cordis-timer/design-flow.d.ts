declare module "@flow/run" {
  export type JsonValue = import("jig").JsonValue;
  export interface Run<Input> {
    readonly input: Readonly<Input>;
    readonly signal: AbortSignal;
    readonly effects: {
      call<Result extends JsonValue>(request: { readonly operationId: string; readonly slot: string; readonly method: string; readonly input: JsonValue }): Promise<Result>;
    };
  }
  export function serve<Input>(handler: (run: Run<Input>) => Promise<{ readonly outcome: string; readonly output: JsonValue }>): void;
}

declare module "@flow/service" {
  export type JsonValue = import("jig").JsonValue;
  export interface EffectClient {
    call<Result extends JsonValue>(request: { readonly operationId: string; readonly slot: string; readonly method: string; readonly input: JsonValue }): Promise<Result>;
  }
  export interface ServiceInvocation { readonly signal: AbortSignal; readonly effects: EffectClient }
  export interface ServiceMount {
    readonly signal: AbortSignal;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly effects: EffectClient;
    provide(name: string, methods: Readonly<Record<string, (input: JsonValue, invocation: ServiceInvocation) => Promise<JsonValue>>>): void;
    ready(exports: readonly string[]): Promise<void>;
  }
  export function capabilityError(name: string, data: JsonValue): Error;
  export function serveService(handler: (mount: ServiceMount) => Promise<void>): void;
}

declare module "cordis" {
  export interface Context {
    readonly fiber: { dispose(): Promise<void> };
    timeout(callback: () => void, delay: number): () => void;
    plugin(plugin: unknown, config?: unknown): PromiseLike<{ dispose(): Promise<void> }>;
  }
  export class Context {
    constructor();
  }
}

declare module "@cordisjs/plugin-timer" {
  const TimerService: unknown;
  export default TimerService;
}


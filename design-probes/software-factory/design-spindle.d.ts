// DESIGN PROBE ONLY.
// Disposable syntax scaffolding for immutable Spindle state threading.

declare module "spindle" {
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

  export interface AgentResult {
    readonly outcome: "completed" | "blocked" | "limit";
    readonly text: string;
    readonly structured?: JsonValue;
  }

  export interface ChildResult {
    readonly outcome: string;
    readonly output: JsonValue;
  }

  export interface Transition<Action extends string, State> {
    readonly action: Action;
    readonly state: State;
  }

  export function transition<Action extends string, State>(
    action: Action,
    state: State,
  ): Transition<Action, State>;

  export interface NodeContext<Root, State> {
    readonly root: DeepReadonly<Root>;
    readonly state: DeepReadonly<State>;
    readonly signal: AbortSignal;
    readonly effects: {
      call<Result>(
        localOperation: string,
        request: {
          readonly slot: string;
          readonly method: string;
          readonly input: JsonValue;
        },
      ): Promise<Result>;
    };
    readonly flows: {
      call(
        localOperation: string,
        request: {
          readonly slot: string;
          readonly intent?: string;
          readonly input: JsonValue;
        },
      ): Promise<ChildResult>;
    };
  }

  export abstract class Node<Root, Input, Output> {
    abstract execute(
      context: NodeContext<Root, Input>,
    ): Promise<Output | Transition<string, Output>>;

    next<NextOutput>(
      target: Node<Root, Output, NextOutput>,
    ): this;

    on<NextOutput>(
      action: string,
      target: Node<Root, Output, NextOutput>,
    ): this;
  }

  export class Flow<Root, Input, Output>
    extends Node<Root, Input, Output> {
    constructor(start: Node<Root, Input, unknown>);
    execute(
      context: NodeContext<Root, Input>,
    ): Promise<Output | Transition<string, Output>>;
  }

  export abstract class Agent<Root, Input, Output>
    extends Node<Root, Input, Output> {
    protected constructor(using: string);

    protected runAgent(
      context: NodeContext<Root, Input>,
      localOperation: string,
      request: {
        readonly instructions: string;
        readonly skills?: readonly string[];
      },
    ): Promise<AgentResult>;
  }

  export interface ParallelResult<State, Results extends readonly unknown[]> {
    readonly state: State;
    readonly results: Results;
  }

  export class Parallel<
    Root,
    State,
    Results extends readonly unknown[],
  > extends Node<Root, State, ParallelResult<State, Results>> {
    constructor(
      branches: {
        readonly [Index in keyof Results]: Node<Root, State, Results[Index]>;
      },
    );

    execute(
      context: NodeContext<Root, State>,
    ): Promise<ParallelResult<State, Results>>;
  }

  export class Outcome<Root, State>
    extends Node<Root, State, State> {
    constructor(
      outcome: string,
      output?: (
        context: NodeContext<Root, State>,
      ) => JsonValue,
    );

    // A missing projection emits the required empty output object `{}`.

    execute(
      context: NodeContext<Root, State>,
    ): Promise<State>;
  }

  export class Router<Root, State>
    extends Node<Root, State, State> {
    constructor(definition: {
      readonly using: string;
      readonly objective: string;
    });

    to<Output>(
      id: string,
      target: Node<Root, State, Output>,
      description: string,
    ): this;

    onAbstain<Output>(
      target: Node<Root, State, Output>,
    ): this;

    execute(
      context: NodeContext<Root, State>,
    ): Promise<State>;
  }
}

// DESIGN PROBE ONLY.
// This declaration is disposable syntax scaffolding, not a Spindle API draft.

declare module "spindle" {
  export abstract class Node {
    next(target: Node): this;
  }

  export class Flow extends Node {
    constructor(start: Node);
  }

  export class Agent extends Node {
    constructor(definition: {
      readonly using: string;
      readonly instructions: string;
    });
  }

  export class FlowCall extends Node {
    constructor(definition: {
      readonly slot: string;
      readonly intent: string;
    });
  }

  export class Outcome extends Node {
    constructor(outcome: "done" | "blocked");
  }

  export class Router extends Node {
    constructor(definition: {
      readonly using: string;
      readonly objective: string;
    });

    to(
      id: string,
      target: Node,
      description: string,
    ): this;

    onAbstain(target: Node): this;
  }
}

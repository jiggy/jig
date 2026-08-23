#!/usr/bin/env spindle

// DESIGN PROBE ONLY: coherent pseudocode against a hypothetical Spindle API.
import {
  Agent,
  type AgentResult,
  Flow,
  type JsonValue,
  Node,
  type NodeContext,
  Outcome,
  Parallel,
  type ParallelResult,
  Router,
  transition,
} from "spindle";

interface InboxEvent {
  readonly eventId: string;
  readonly type: string;
  readonly data: {
    readonly item: string;
    readonly request: string;
  };
}

interface Reference {
  readonly target: string;
  readonly criteria: readonly string[];
}

interface FactoryState {
  readonly event: InboxEvent;
  readonly reference?: Reference;
  readonly build?: AgentResult;
  readonly review?: AgentResult;
  readonly revision?: AgentResult;
  readonly verification?: AgentResult;
  readonly votes?: readonly [AgentResult, AgentResult, AgentResult];
  readonly final?: AgentResult;
}

type WorkerResultKey =
  | "build"
  | "review"
  | "revision"
  | "verification"
  | "final";

const asJson = (value: unknown): JsonValue =>
  value as JsonValue;

const scalarLength = (value: string): number =>
  Array.from(value).length;

const parseReference = (value: JsonValue): Reference | undefined => {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== "object"
  ) {
    return undefined;
  }

  const record = value as { readonly [name: string]: JsonValue };
  const target = record.target;
  const criteria = record.criteria;

  if (
    typeof target !== "string" ||
    target.length === 0 ||
    scalarLength(target) > 4096 ||
    !Array.isArray(criteria) ||
    criteria.length === 0 ||
    criteria.length > 32 ||
    !criteria.every(
      item =>
        typeof item === "string" &&
        item.length > 0 &&
        scalarLength(item) <= 4096,
    )
  ) {
    return undefined;
  }

  return {
    target,
    criteria,
  };
};

class Initialize extends Node<InboxEvent, InboxEvent, FactoryState> {
  async execute({ root }: NodeContext<InboxEvent, InboxEvent>) {
    return { event: root as InboxEvent };
  }
}

class Research extends Node<InboxEvent, FactoryState, FactoryState> {
  async execute(context: NodeContext<InboxEvent, FactoryState>) {
    const child = await context.flows.call(
      "reference",
      {
        slot: "reference-research",
        intent:
          "Research and justify a suitable quality reference for this ticket.",
        input: asJson(context.state.event),
      },
    );

    if (child.outcome !== "done") {
      return transition("blocked", context.state as FactoryState);
    }

    const reference = parseReference(child.output);
    if (reference === undefined) {
      return transition("blocked", context.state as FactoryState);
    }

    return {
      ...context.state,
      reference,
    } as FactoryState;
  }
}

class WorkerStep extends Agent<InboxEvent, FactoryState, FactoryState> {
  constructor(
    private readonly operation: string,
    private readonly resultKey: WorkerResultKey,
    private readonly instructions: (
      context: NodeContext<InboxEvent, FactoryState>,
    ) => string,
  ) {
    super("worker");
  }

  async execute(context: NodeContext<InboxEvent, FactoryState>) {
    const result = await this.runAgent(
      context,
      this.operation,
      this.instructions(context),
    );
    const state = {
      ...context.state,
      [this.resultKey]: result,
    } as FactoryState;

    return result.outcome === "completed"
      ? state
      : transition("blocked", state);
  }
}

class Voter extends Agent<InboxEvent, FactoryState, AgentResult> {
  constructor(private readonly perspective: string) {
    super("analyst");
  }

  async execute(context: NodeContext<InboxEvent, FactoryState>) {
    return this.runAgent(
      context,
      `vote-${this.perspective}`,
      [
        "Independently propose a software implementation approach.",
        `Perspective: ${this.perspective}.`,
        `Ticket: ${JSON.stringify(context.root)}`,
        "Do not modify files.",
      ].join("\n"),
    );
  }
}

type VoteTuple = readonly [AgentResult, AgentResult, AgentResult];

class JoinVotes extends Node<
  InboxEvent,
  ParallelResult<FactoryState, VoteTuple>,
  FactoryState
> {
  async execute(
    context: NodeContext<
      InboxEvent,
      ParallelResult<FactoryState, VoteTuple>
    >,
  ) {
    const state = {
      ...context.state.state,
      votes: context.state.results,
    } as FactoryState;

    return context.state.results.every(
      result => result.outcome === "completed",
    )
      ? state
      : transition("blocked", state);
  }
}

const gauntletDone = new Outcome<InboxEvent, FactoryState>(
  "done",
  ({ state }) => ({
    strategy: "gauntlet",
    evidence: state.verification?.text ?? "",
  }),
);
const gauntletBlocked = new Outcome<InboxEvent, FactoryState>("blocked");

const research = new Research();
const build = new WorkerStep(
  "build",
  "build",
  ({ root, state }) => [
    "Implement the smallest testable version in the workspace.",
    `Ticket: ${JSON.stringify(root)}`,
    `Reference: ${JSON.stringify(state.reference)}`,
  ].join("\n"),
);
const review = new WorkerStep(
  "review",
  "review",
  ({ root, state }) => [
    "Review the implementation against the request and reference.",
    `Ticket: ${JSON.stringify(root)}`,
    `Reference: ${JSON.stringify(state.reference)}`,
    `Build report: ${state.build?.text ?? ""}`,
  ].join("\n"),
);
const revise = new WorkerStep(
  "revise",
  "revision",
  ({ state }) => [
    "Fix the material review findings without unrelated changes.",
    `Review: ${state.review?.text ?? ""}`,
  ].join("\n"),
);
const verify = new WorkerStep(
  "verify",
  "verification",
  ({ state }) => [
    "Use the projected Flow-local skill named focused-validation.",
    "Run the smallest relevant checks and summarize the final evidence.",
    `Revision: ${state.revision?.text ?? ""}`,
  ].join("\n"),
);

research.next(build).on("blocked", gauntletBlocked);
build.next(review).on("blocked", gauntletBlocked);
review.next(revise).on("blocked", gauntletBlocked);
revise.next(verify).on("blocked", gauntletBlocked);
verify.next(gauntletDone).on("blocked", gauntletBlocked);
const gauntlet = new Flow<InboxEvent, FactoryState, FactoryState>(research);

const voters = new Parallel<InboxEvent, FactoryState, VoteTuple>([
  new Voter("safety and failure boundaries"),
  new Voter("simplicity and smallest correct change"),
  new Voter("quality and verification evidence"),
]);
const joinVotes = new JoinVotes();
const majorityDone = new Outcome<InboxEvent, FactoryState>(
  "done",
  ({ state }) => ({
    strategy: "majority-vote",
    evidence: state.final?.text ?? "",
  }),
);
const majorityBlocked = new Outcome<InboxEvent, FactoryState>("blocked");
const synthesize = new WorkerStep(
  "synthesize",
  "final",
  ({ root, state }) => [
    "Synthesize the three independent views and implement the result.",
    "Use the projected Flow-local skill named focused-validation to verify it.",
    `Ticket: ${JSON.stringify(root)}`,
    `Votes: ${JSON.stringify(state.votes)}`,
  ].join("\n"),
);

voters.next(joinVotes);
joinVotes.next(synthesize).on("blocked", majorityBlocked);
synthesize.next(majorityDone).on("blocked", majorityBlocked);
const majorityVote = new Flow<InboxEvent, FactoryState, FactoryState>(voters);

const route = new Router<InboxEvent, FactoryState>({
  using: "choice",
  objective: "Choose the better fixed strategy for the committed ticket.",
});
const routeBlocked = new Outcome<InboxEvent, FactoryState>("blocked");

route.to(
  "gauntlet",
  gauntlet,
  "Use iterative implementation, critique, revision, and verification.",
);
route.to(
  "majority-vote",
  majorityVote,
  "Use independent analysis before synthesizing one implementation.",
);
route.onAbstain(routeBlocked);

const initialize = new Initialize();
initialize.next(route);

export default new Flow<InboxEvent, InboxEvent, FactoryState>(initialize);

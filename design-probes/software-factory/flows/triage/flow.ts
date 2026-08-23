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

type Strategy = "gauntlet" | "majority-vote";

type Stage =
  | "triage"
  | "research"
  | "voting"
  | "implementation"
  | "review"
  | "revision"
  | "verification"
  | "done"
  | "blocked";

interface InboxEvent {
  readonly eventId: string;
  readonly type: string;
  readonly data: {
    readonly submissionId: string;
    readonly item: string;
    readonly request: string;
  };
}

interface KanbanCard {
  readonly cardId: string;
  readonly submissionId: string;
  readonly title: string;
  readonly request: string;
  readonly strategy?: Strategy;
  readonly stage: Stage;
  readonly revision: number;
  readonly history: readonly {
    readonly revision: number;
    readonly stage: Stage;
    readonly note?: string;
  }[];
}

interface Reference {
  readonly target: string;
  readonly criteria: readonly string[];
}

interface FactoryState {
  readonly event: InboxEvent;
  readonly card: KanbanCard;
  readonly reference?: Reference;
  readonly build?: AgentResult;
  readonly review?: AgentResult;
  readonly revision?: AgentResult;
  readonly verification?: AgentResult;
  readonly votes?: readonly [AgentResult, AgentResult, AgentResult];
  readonly final?: AgentResult;
}

type ReadonlyFactoryState = NodeContext<
  InboxEvent,
  FactoryState
>["state"];

type WorkerResultKey =
  | "build"
  | "review"
  | "revision"
  | "verification"
  | "final";

const asJson = (value: unknown): JsonValue => value as JsonValue;

const scalarLength = (value: string): number => Array.from(value).length;

const excerpt = (value: string, limit = 65_536): string =>
  Array.from(value).slice(0, limit).join("");

const jsonExcerpt = (value: unknown, limit = 200_000): string =>
  excerpt(JSON.stringify(value) ?? "null", limit);

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

  return { target, criteria };
};

class OpenCard extends Node<InboxEvent, InboxEvent, FactoryState> {
  async execute(context: NodeContext<InboxEvent, InboxEvent>) {
    const event = context.root as InboxEvent;
    const card = await context.effects.call<KanbanCard>(
      "ensure-kanban-card",
      {
        slot: "kanban",
        method: "ensure",
        input: asJson({
          submissionId: event.data.submissionId,
          title: event.data.item,
          request: event.data.request,
        }),
      },
    );

    const state = { event, card };
    return card.stage === "triage"
      ? state
      : transition("duplicate", state);
  }
}

class MoveCard extends Node<InboxEvent, FactoryState, FactoryState> {
  constructor(
    private readonly stage: Stage,
    private readonly note: string,
    private readonly strategy?: Strategy,
  ) {
    super();
  }

  async execute(context: NodeContext<InboxEvent, FactoryState>) {
    const card = await context.effects.call<KanbanCard>(
      `move-card-${this.stage}`,
      {
        slot: "kanban",
        method: "transition",
        input: asJson({
          cardId: context.state.card.cardId,
          expectedRevision: context.state.card.revision,
          stage: this.stage,
          note: this.note,
          ...(this.strategy === undefined
            ? {}
            : { strategy: this.strategy }),
        }),
      },
    );

    return {
      ...context.state,
      card,
    } as FactoryState;
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
    private readonly skills: readonly string[],
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
      {
        instructions: this.instructions(context),
        skills: this.skills,
      },
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
      {
        skills: ["solution-design"],
        instructions: [
          "Use the selected solution-design skill.",
          "Independently propose a software implementation approach.",
          `Perspective: ${this.perspective}.`,
          `Ticket: ${jsonExcerpt(context.root)}`,
          "Do not modify files.",
        ].join("\n"),
      },
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

const blockedOutput = ({ state }: NodeContext<InboxEvent, FactoryState>) => ({
  cardId: state.card.cardId,
});

const duplicateOutput = (
  { state }: NodeContext<InboxEvent, FactoryState>,
) => ({
  cardId: state.card.cardId,
  stage: state.card.stage,
});

const doneOutput = (
  strategy: Strategy,
  evidence: (state: ReadonlyFactoryState) => string,
) => ({ state }: NodeContext<InboxEvent, FactoryState>) => ({
  cardId: state.card.cardId,
  strategy,
  evidence: evidence(state),
});

// Gauntlet: research -> implementation -> review -> revision -> verification.
const gauntletBlocked = new Outcome<InboxEvent, FactoryState>(
  "blocked",
  blockedOutput,
);
const gauntletBlock = new MoveCard("blocked", "Gauntlet could not continue.");
gauntletBlock.next(gauntletBlocked);

const enterResearch = new MoveCard(
  "research",
  "Selecting and validating a quality reference.",
  "gauntlet",
);
const research = new Research();
const enterImplementation = new MoveCard(
  "implementation",
  "Building the smallest testable implementation.",
);
const build = new WorkerStep(
  "build",
  "build",
  ["focused-coding"],
  ({ root, state }) => [
    "Use the selected focused-coding skill.",
    "Implement the smallest testable version in the workspace.",
    `Ticket: ${jsonExcerpt(root)}`,
    `Reference: ${jsonExcerpt(state.reference)}`,
  ].join("\n"),
);
const enterReview = new MoveCard(
  "review",
  "Reviewing the implementation against the request and reference.",
);
const review = new WorkerStep(
  "review",
  "review",
  ["focused-validation"],
  ({ root, state }) => [
    "Use the selected focused-validation skill.",
    "Review the implementation against the request and reference.",
    `Ticket: ${jsonExcerpt(root)}`,
    `Reference: ${jsonExcerpt(state.reference)}`,
    `Build report: ${excerpt(state.build?.text ?? "")}`,
  ].join("\n"),
);
const enterRevision = new MoveCard(
  "revision",
  "Applying material review findings.",
);
const revise = new WorkerStep(
  "revise",
  "revision",
  ["focused-coding"],
  ({ state }) => [
    "Use the selected focused-coding skill.",
    "Fix the material review findings without unrelated changes.",
    `Review: ${excerpt(state.review?.text ?? "")}`,
  ].join("\n"),
);
const enterVerification = new MoveCard(
  "verification",
  "Running focused final checks.",
);
const verify = new WorkerStep(
  "verify",
  "verification",
  ["focused-validation"],
  ({ state }) => [
    "Use the selected focused-validation skill.",
    "Run the smallest relevant checks and summarize the final evidence.",
    `Revision: ${excerpt(state.revision?.text ?? "")}`,
  ].join("\n"),
);
const gauntletDoneCard = new MoveCard("done", "Gauntlet completed.");
const gauntletDone = new Outcome<InboxEvent, FactoryState>(
  "done",
  doneOutput("gauntlet", state => state.verification?.text ?? ""),
);

enterResearch.next(research);
research.next(enterImplementation).on("blocked", gauntletBlock);
enterImplementation.next(build);
build.next(enterReview).on("blocked", gauntletBlock);
enterReview.next(review);
review.next(enterRevision).on("blocked", gauntletBlock);
enterRevision.next(revise);
revise.next(enterVerification).on("blocked", gauntletBlock);
enterVerification.next(verify);
verify.next(gauntletDoneCard).on("blocked", gauntletBlock);
gauntletDoneCard.next(gauntletDone);
const gauntlet = new Flow<InboxEvent, FactoryState, FactoryState>(
  enterResearch,
);

// Majority Vote: voting -> implementation -> verification.
const majorityBlocked = new Outcome<InboxEvent, FactoryState>(
  "blocked",
  blockedOutput,
);
const majorityBlock = new MoveCard(
  "blocked",
  "Majority-vote strategy could not continue.",
);
majorityBlock.next(majorityBlocked);

const enterVoting = new MoveCard(
  "voting",
  "Collecting independent implementation proposals.",
  "majority-vote",
);
const voters = new Parallel<InboxEvent, FactoryState, VoteTuple>([
  new Voter("safety and failure boundaries"),
  new Voter("simplicity and smallest correct change"),
  new Voter("quality and verification evidence"),
]);
const joinVotes = new JoinVotes();
const enterVotedImplementation = new MoveCard(
  "implementation",
  "Synthesizing votes and implementing the selected approach.",
);
const synthesize = new WorkerStep(
  "synthesize",
  "final",
  ["focused-coding"],
  ({ root, state }) => [
    "Use the selected focused-coding skill.",
    "Synthesize the three independent views and implement the result.",
    `Ticket: ${jsonExcerpt(root)}`,
    `Votes: ${jsonExcerpt(
      state.votes?.map(vote => ({
        outcome: vote.outcome,
        text: excerpt(vote.text),
      })),
    )}`,
  ].join("\n"),
);
const enterVotedVerification = new MoveCard(
  "verification",
  "Validating the majority-vote implementation.",
);
const verifyMajority = new WorkerStep(
  "verify-majority",
  "verification",
  ["focused-validation"],
  ({ state }) => [
    "Use the selected focused-validation skill.",
    "Run the smallest relevant checks against the implemented result.",
    `Implementation report: ${excerpt(state.final?.text ?? "")}`,
  ].join("\n"),
);
const majorityDoneCard = new MoveCard("done", "Majority vote completed.");
const majorityDone = new Outcome<InboxEvent, FactoryState>(
  "done",
  doneOutput("majority-vote", state => state.verification?.text ?? ""),
);

enterVoting.next(voters);
voters.next(joinVotes);
joinVotes.next(enterVotedImplementation).on("blocked", majorityBlock);
enterVotedImplementation.next(synthesize);
synthesize.next(enterVotedVerification).on("blocked", majorityBlock);
enterVotedVerification.next(verifyMajority);
verifyMajority.next(majorityDoneCard).on("blocked", majorityBlock);
majorityDoneCard.next(majorityDone);
const majorityVote = new Flow<InboxEvent, FactoryState, FactoryState>(
  enterVoting,
);

const route = new Router<InboxEvent, FactoryState>({
  using: "choice",
  objective: "Choose the better fixed strategy for the committed ticket.",
});
const routeBlocked = new Outcome<InboxEvent, FactoryState>(
  "blocked",
  blockedOutput,
);
const routeBlock = new MoveCard("blocked", "No strategy was selected.");
routeBlock.next(routeBlocked);

route.to(
  "gauntlet",
  gauntlet,
  "Use iterative implementation, review, revision, and verification.",
);
route.to(
  "majority-vote",
  majorityVote,
  "Use independent analysis before one implementation and verification.",
);
route.onAbstain(routeBlock);

const openCard = new OpenCard();
const duplicate = new Outcome<InboxEvent, FactoryState>(
  "duplicate",
  duplicateOutput,
);
openCard.next(route).on("duplicate", duplicate);

export default new Flow<InboxEvent, InboxEvent, FactoryState>(openCard);

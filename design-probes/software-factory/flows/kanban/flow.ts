#!/usr/bin/env deno

// DESIGN PROBE ONLY: smallest file-backed, single-writer Kanban Service.
import {
  capabilityError,
  type JsonValue,
  serveService,
} from "@flowmd/sdk";

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

interface HistoryEntry {
  readonly revision: number;
  readonly stage: Stage;
  readonly note?: string;
}

interface Card {
  readonly cardId: string;
  readonly submissionId: string;
  readonly title: string;
  readonly request: string;
  readonly strategy?: "gauntlet" | "majority-vote";
  readonly stage: Stage;
  readonly revision: number;
  readonly history: readonly HistoryEntry[];
}

interface EnsureInput {
  readonly submissionId: string;
  readonly title: string;
  readonly request: string;
}

interface TransitionInput {
  readonly cardId: string;
  readonly expectedRevision: number;
  readonly stage: Stage;
  readonly strategy?: "gauntlet" | "majority-vote";
  readonly note?: string;
}

const NEXT: Readonly<Record<Stage, readonly Stage[]>> = {
  triage: ["research", "voting", "blocked"],
  research: ["implementation", "blocked"],
  voting: ["implementation", "blocked"],
  implementation: ["review", "verification", "blocked"],
  review: ["revision", "verification", "blocked"],
  revision: ["verification", "blocked"],
  verification: ["done", "blocked"],
  done: [],
  blocked: [],
};

const asJson = (card: Card): JsonValue => card as unknown as JsonValue;

const parseCard = (source: string): Card => JSON.parse(source) as Card;

// Schema/1 intentionally omits regex. Domain identifiers are checked by the
// operation before they can become filesystem names.
const isSubmissionId = (value: string): boolean =>
  /^[0-9a-f]{64}$/.test(value);

const isCardId = (value: string): boolean =>
  /^card-[0-9a-f]{64}$/.test(value);

serveService(async mount => {
  const board = mount.attachment("board");
  const cards = board.resolve("cards");
  await Deno.mkdir(cards, { recursive: true });

  let queue: Promise<void> = Promise.resolve();
  const exclusive = async <Value>(operation: () => Promise<Value>) => {
    const previous = queue;
    let release = (): void => {};
    queue = new Promise<void>(resolve => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const pathFor = (cardId: string): string =>
    board.resolve(`cards/${cardId}.json`);

  const read = async (cardId: string): Promise<Card | undefined> => {
    try {
      return parseCard(await Deno.readTextFile(pathFor(cardId)));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  };

  const write = async (card: Card): Promise<void> => {
    const temporary = board.resolve(
      `cards/.${card.cardId}.${card.revision}.tmp`,
    );
    await Deno.writeTextFile(temporary, `${JSON.stringify(card, null, 2)}\n`);
    await Deno.rename(temporary, pathFor(card.cardId));
  };

  return {
    exports: {
      kanban: {
        ensure: input => exclusive(async () => {
          const value = input as unknown as EnsureInput;
          if (!isSubmissionId(value.submissionId)) {
            throw capabilityError("invalid-submission-id", {});
          }
          const cardId = `card-${value.submissionId}`;
          const existing = await read(cardId);

          if (existing !== undefined) {
            if (
              existing.submissionId !== value.submissionId ||
              existing.title !== value.title ||
              existing.request !== value.request
            ) {
              throw capabilityError("submission-conflict", {});
            }
            return asJson(existing);
          }

          const card: Card = {
            cardId,
            submissionId: value.submissionId,
            title: value.title,
            request: value.request,
            stage: "triage",
            revision: 1,
            history: [{ revision: 1, stage: "triage" }],
          };
          await write(card);
          return asJson(card);
        }),

        transition: input => exclusive(async () => {
          const value = input as unknown as TransitionInput;
          if (!isCardId(value.cardId)) {
            throw capabilityError("invalid-card-id", {});
          }
          const current = await read(value.cardId);
          if (current === undefined) throw capabilityError("not-found", {});
          if (current.revision !== value.expectedRevision) {
            throw capabilityError("revision-conflict", {});
          }
          if (!NEXT[current.stage].includes(value.stage)) {
            throw capabilityError("invalid-transition", {});
          }
          const requiredStrategy = value.stage === "research"
            ? "gauntlet"
            : value.stage === "voting"
              ? "majority-vote"
              : undefined;
          if (
            requiredStrategy !== undefined &&
            value.strategy !== requiredStrategy
          ) {
            throw capabilityError("invalid-transition", {});
          }
          if (
            value.strategy !== undefined &&
            current.strategy !== undefined &&
            current.strategy !== value.strategy
          ) {
            throw capabilityError("invalid-transition", {});
          }
          if (current.history.length >= 128) {
            throw capabilityError("invalid-transition", {});
          }

          const revision = current.revision + 1;
          const card: Card = {
            ...current,
            strategy: value.strategy ?? current.strategy,
            stage: value.stage,
            revision,
            history: [
              ...current.history,
              {
                revision,
                stage: value.stage,
                ...(value.note === undefined ? {} : { note: value.note }),
              },
            ],
          };
          await write(card);
          return asJson(card);
        }),
      },
    },
  };
});

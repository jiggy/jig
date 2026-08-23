#!/usr/bin/env bun

// DESIGN PROBE ONLY: complete pseudocode against hypothetical FLOW SDKs.
import { mkdir, rename } from "node:fs/promises";
import {
  capabilityError,
  type EffectClient,
  type JsonValue,
  serveService,
} from "@flow/service";

interface DocumentRecord {
  readonly documentId: string;
  readonly revision: number;
  readonly text: string;
}

interface PendingEvent {
  readonly documentId: string;
  readonly revision: number;
}

interface IndexState {
  readonly documents: readonly DocumentRecord[];
  readonly pendingEvents: readonly PendingEvent[];
}

interface UpsertInput extends DocumentRecord {}

interface GetInput {
  readonly documentId: string;
}

interface SearchInput {
  readonly query: string;
  readonly limit: number;
}

const EMPTY: IndexState = { documents: [], pendingEvents: [] };

const asJson = (value: unknown): JsonValue => value as JsonValue;

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise(resolve =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );

serveService(async mount => {
  const index = mount.attachment("index");
  const statePath = index.resolve("state.json");
  await mkdir(index.path, { recursive: true });

  const readState = async (): Promise<IndexState> => {
    const file = Bun.file(statePath);
    return await file.exists()
      ? JSON.parse(await file.text()) as IndexState
      : EMPTY;
  };

  let writeNumber = 0;
  const writeState = async (state: IndexState): Promise<void> => {
    writeNumber += 1;
    const temporary = index.resolve(`.state.${writeNumber}.tmp`);
    await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, statePath);
  };

  let mutationQueue: Promise<void> = Promise.resolve();
  const mutate = async <Value>(operation: () => Promise<Value>) => {
    const previous = mutationQueue;
    let release = (): void => {};
    mutationQueue = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const drainPending = async (
    initial: IndexState,
    effects: EffectClient,
  ): Promise<IndexState> => {
    let state = initial;
    for (const pending of initial.pendingEvents) {
      await effects.call({
        operationId:
          `publish-document-${pending.documentId}-${pending.revision}`,
        slot: "journal",
        method: "append",
        input: asJson({
          type: "https://probe.jig.dev/events/document-indexed",
          subject: pending.documentId,
          data: {
            documentId: pending.documentId,
            revision: pending.revision,
          },
        }),
      });
      state = {
        ...state,
        pendingEvents: state.pendingEvents.filter(
          item =>
            item.documentId !== pending.documentId ||
            item.revision !== pending.revision,
        ),
      };
      await writeState(state);
    }
    return state;
  };

  mount.provide("writer", {
    upsert: (input, invocation) => mutate(async () => {
      const value = input as unknown as UpsertInput;
      const before = await readState();
      const current = before.documents.find(
        document => document.documentId === value.documentId,
      );
      const currentRevision = current?.revision ?? 0;

      if (current?.revision === value.revision) {
        if (current.text !== value.text) {
          throw capabilityError(
            "revision-conflict",
            asJson({ currentRevision }),
          );
        }
        await drainPending(before, invocation.effects);
        return asJson(current);
      }

      if (value.revision !== currentRevision + 1) {
        throw capabilityError(
          "stale-revision",
          asJson({ currentRevision }),
        );
      }

      const next: IndexState = {
        documents: [
          ...before.documents.filter(
            document => document.documentId !== value.documentId,
          ),
          value,
        ],
        pendingEvents: [
          ...before.pendingEvents,
          { documentId: value.documentId, revision: value.revision },
        ],
      };
      await writeState(next);
      await drainPending(next, invocation.effects);
      return asJson(value);
    }),
  });

  mount.provide("reader", {
    get: async input => {
      const value = input as unknown as GetInput;
      const record = (await readState()).documents.find(
        document => document.documentId === value.documentId,
      );
      if (record === undefined) {
        throw capabilityError("not-found", {});
      }
      return asJson(record);
    },

    search: async input => {
      const value = input as unknown as SearchInput;
      const query = value.query.toLocaleLowerCase("und");
      const documents = (await readState()).documents;
      const hits = documents
        .filter(document =>
          document.text.toLocaleLowerCase("und").includes(query)
        )
        .slice(0, value.limit)
        .map(document => ({
          documentId: document.documentId,
          revision: document.revision,
          excerpt: document.text.slice(0, 4096),
        }));
      return asJson({ hits });
    },

    stats: async () => {
      const state = await readState();
      return asJson({
        documents: state.documents.length,
        pendingEvents: state.pendingEvents.length,
      });
    },
  });

  await mutate(async () => {
    await drainPending(await readState(), mount.effects);
  });
  await mount.ready(["reader", "writer"]);
  await waitForAbort(mount.signal);
});

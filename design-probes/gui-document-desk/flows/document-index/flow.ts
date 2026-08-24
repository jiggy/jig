#!/usr/bin/env bun

// DESIGN PROBE ONLY: complete pseudocode against the future FLOW SDK.
import { mkdir, rename } from "node:fs/promises";
import {
  capabilityError,
  type JsonValue,
  serveService,
} from "@flowmd/sdk";

interface DocumentRecord {
  readonly documentId: string;
  readonly revision: number;
  readonly text: string;
}

interface IndexState {
  readonly documents: readonly DocumentRecord[];
}

interface SearchInput {
  readonly query: string;
  readonly limit: number;
}

const asJson = (value: unknown): JsonValue => value as JsonValue;

serveService(async mount => {
  const index = mount.attachment("index");
  const statePath = index.resolve("state.json");
  await mkdir(index.path, { recursive: true });

  const read = async (): Promise<IndexState> => {
    const file = Bun.file(statePath);
    return await file.exists()
      ? JSON.parse(await file.text()) as IndexState
      : { documents: [] };
  };

  let writeNumber = 0;
  const write = async (state: IndexState): Promise<void> => {
    const temporary = index.resolve(`.state.${++writeNumber}.tmp`);
    await Bun.write(temporary, `${JSON.stringify(state, null, 2)}\n`);
    await rename(temporary, statePath);
  };

  let mutations = Promise.resolve();
  const serialized = async <Value>(operation: () => Promise<Value>) => {
    const previous = mutations;
    let release = (): void => {};
    mutations = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  return {
    exports: {
      writer: {
        upsert: (input: JsonValue) => serialized(async () => {
          const value = input as unknown as DocumentRecord;
          const state = await read();
          const current = state.documents.find(
            document => document.documentId === value.documentId,
          );
          const currentRevision = current?.revision ?? 0;

          if (current?.revision === value.revision) {
            if (current.text !== value.text) {
              throw capabilityError("revision-conflict", { currentRevision });
            }
            return asJson(current);
          }
          if (value.revision !== currentRevision + 1) {
            throw capabilityError("stale-revision", { currentRevision });
          }

          await write({
            documents: [
              ...state.documents.filter(
                document => document.documentId !== value.documentId,
              ),
              value,
            ],
          });
          return asJson(value);
        }),
      },
      reader: {
        search: async (input: JsonValue) => {
          const value = input as unknown as SearchInput;
          const query = value.query.toLocaleLowerCase("und");
          const hits = (await read()).documents
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
      },
    },
  };
});

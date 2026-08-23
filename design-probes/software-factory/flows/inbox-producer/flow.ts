#!/usr/bin/env deno

// DESIGN PROBE ONLY: hypothetical SDK, complete pseudocode behavior.
import {
  type JsonValue,
  serve,
} from "@flow/run";

interface InboxInput {
  readonly item: string;
}

serve<InboxInput, Record<string, never>>(async run => {
  const inbox = run.attachment("inbox");
  const request = await Deno.readTextFile(
    inbox.resolve(run.input.item),
  );

  const event = await run.effects.call<JsonValue>({
    operationId: "publish-inbox-item",
    slot: "journal",
    method: "append",
    input: {
      type: "https://jig.example/events/inbox-item-created",
      subject: run.input.item,
      data: {
        item: run.input.item,
        request,
      },
    },
  });

  return {
    outcome: "done",
    output: { event },
  };
});

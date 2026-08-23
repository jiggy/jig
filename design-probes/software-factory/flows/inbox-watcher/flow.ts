#!/usr/bin/env deno

// DESIGN PROBE ONLY: a minimal at-least-once filesystem producer Service.
import {
  type Attachment,
  type ServiceMount,
  serveService,
} from "@flow/service";

const ITEM = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,251}\.md$/;
const SETTLE_MS = 250;
const MAX_BYTES = 1_048_576;
const MAX_SCALARS = 262_144;
const utf8 = new TextDecoder("utf-8", { fatal: true });

const delay = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const sameSnapshot = (
  left: Deno.FileInfo,
  right: Deno.FileInfo,
): boolean =>
  left.isFile &&
  right.isFile &&
  left.size === right.size &&
  left.mtime?.getTime() === right.mtime?.getTime();

const stableRead = async (
  inbox: Attachment,
  item: string,
): Promise<string | undefined> => {
  if (!ITEM.test(item)) return undefined;

  try {
    const path = inbox.resolve(item);
    const first = await Deno.stat(path);
    if (!first.isFile || first.size > MAX_BYTES) return undefined;

    const firstRequest = utf8.decode(await Deno.readFile(path));
    const afterFirstRead = await Deno.stat(path);
    if (!sameSnapshot(first, afterFirstRead)) return undefined;

    await delay(SETTLE_MS);
    const before = await Deno.stat(path);
    if (!sameSnapshot(afterFirstRead, before)) return undefined;

    const request = utf8.decode(await Deno.readFile(path));
    const after = await Deno.stat(path);
    const scalarCount = Array.from(request).length;
    if (
      !sameSnapshot(before, after) ||
      firstRequest !== request ||
      scalarCount === 0 ||
      scalarCount > MAX_SCALARS
    ) {
      return undefined;
    }

    return request;
  } catch (error) {
    // A concurrent delete, file-to-directory replacement, or invalid UTF-8
    // is not a submission. Authority and I/O failures remain fatal.
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.IsADirectory ||
      error instanceof TypeError
    ) {
      return undefined;
    }
    throw error;
  }
};

const digest = async (item: string, request: string): Promise<string> => {
  const bytes = new TextEncoder().encode(`${item}\0${request}`);
  const value = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(value), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const publish = async (
  mount: ServiceMount,
  inbox: Attachment,
  item: string,
  seen: Set<string>,
): Promise<void> => {
  const request = await stableRead(inbox, item);
  if (request === undefined) return;

  const submissionId = await digest(item, request);
  if (seen.has(submissionId)) return;

  await mount.effects.call({
    operationId: `publish-${submissionId}`,
    slot: "journal",
    method: "append",
    input: {
      type: "https://jig.example/events/inbox-item-created",
      subject: item,
      data: {
        submissionId,
        item,
        request,
      },
    },
  });

  seen.add(submissionId);
};

serveService(async mount => {
  const inbox = mount.attachment("inbox");
  const watcher = Deno.watchFs(inbox.path);
  const seen = new Set<string>();

  mount.signal.addEventListener("abort", () => watcher.close(), {
    once: true,
  });

  // The watcher exists before readiness and the initial scan, so a file which
  // changes during the scan is still observed by the queued watch event.
  await mount.ready([]);

  for await (const entry of Deno.readDir(inbox.path)) {
    if (entry.isFile) await publish(mount, inbox, entry.name, seen);
  }

  try {
    for await (const event of watcher) {
      if (mount.signal.aborted) break;
      for (const path of event.paths) {
        const item = inbox.relative(path);
        if (item !== undefined) await publish(mount, inbox, item, seen);
      }
    }
  } finally {
    watcher.close();
  }
});

#!/usr/bin/env bun

// DESIGN PROBE ONLY: real Cordis APIs behind hypothetical FLOW Service SDK.
import { Context, type Context as CordisContext } from "cordis";
import Timer from "@cordisjs/plugin-timer";
import {
  capabilityError,
  type JsonValue,
  serveService,
} from "@flow/service";

type TimerStatus = "pending" | "fired" | "cancelled" | "failed" | "uncertain";

interface TimerRecord {
  readonly timerId: string;
  status: TimerStatus;
  readonly payload: JsonValue;
  dispose?: () => void;
}

interface SchedulerBridge {
  schedule(timerId: string, delayMs: number, payload: JsonValue): TimerRecord;
  cancel(timerId: string): TimerRecord | undefined;
  get(timerId: string): TimerRecord | undefined;
  list(): readonly TimerRecord[];
}

const waitForAbort = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise(resolve =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );

const publicRecord = (record: TimerRecord): JsonValue => ({
  timerId: record.timerId,
  status: record.status,
});

serveService(async mount => {
  const root = new Context();
  const maxTimerRecords = mount.settings.maxTimerRecords as number;
  const records = new Map<string, TimerRecord>();
  const publications = new Set<Promise<void>>();
  let scheduler: SchedulerBridge | undefined;

  const Bridge = {
    name: "flow-scheduler-bridge",
    inject: ["timer"],
    apply(ctx: CordisContext) {
      scheduler = {
        schedule(timerId, delayMs, payload) {
          if (records.has(timerId)) {
            throw capabilityError("timer-conflict", { timerId });
          }
          if (records.size >= maxTimerRecords) {
            throw capabilityError("capacity", {});
          }

          const record: TimerRecord = { timerId, status: "pending", payload };
          records.set(timerId, record);
          record.dispose = ctx.timeout(() => {
            record.dispose = undefined;
            const publication = mount.effects.call({
              operationId: `publish-timer-${timerId}`,
              slot: "journal",
              method: "append",
              input: {
                type: "https://probe.jig.dev/events/timer-fired",
                subject: timerId,
                data: { timerId, payload },
              },
            }).then(
              () => { record.status = "fired"; },
              error => {
                const code = typeof error === "object" && error !== null &&
                  "code" in error ? error.code : undefined;
                record.status = code === "OPERATION_UNCERTAIN"
                  ? "uncertain"
                  : "failed";
              },
            ).finally(() => publications.delete(publication));
            publications.add(publication);
          }, delayMs);
          return record;
        },

        cancel(timerId) {
          const record = records.get(timerId);
          if (!record) return undefined;
          if (record.status === "pending") {
            record.dispose?.();
            record.dispose = undefined;
            record.status = "cancelled";
          }
          return record;
        },

        get: timerId => records.get(timerId),
        list: () => [...records.values()].sort((a, b) =>
          a.timerId.localeCompare(b.timerId)
        ),
      };

      return () => {
        for (const record of records.values()) record.dispose?.();
        scheduler = undefined;
      };
    },
  };

  await root.plugin(Timer);
  await root.plugin(Bridge);
  if (!scheduler) throw new Error("Cordis scheduler bridge did not activate");

  const active = (): SchedulerBridge => {
    if (!scheduler) throw new Error("Cordis scheduler bridge is unavailable");
    return scheduler;
  };

  mount.provide("scheduler", {
    async schedule(input) {
      const value = input as unknown as {
        readonly timerId: string;
        readonly delayMs: number;
        readonly payload: JsonValue;
      };
      return publicRecord(active().schedule(
        value.timerId,
        value.delayMs,
        value.payload,
      ));
    },

    async cancel(input) {
      const { timerId } = input as unknown as { readonly timerId: string };
      const record = active().cancel(timerId);
      if (!record) throw capabilityError("not-found", { timerId });
      return publicRecord(record);
    },

    async get(input) {
      const { timerId } = input as unknown as { readonly timerId: string };
      const record = active().get(timerId);
      if (!record) throw capabilityError("not-found", { timerId });
      return publicRecord(record);
    },

    async list() {
      return { timers: active().list().map(publicRecord) };
    },
  });

  await mount.ready(["scheduler"]);
  await waitForAbort(mount.signal);
  await root.fiber.dispose();
  await Promise.allSettled(publications);
});

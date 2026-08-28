import { describe, expect, test } from "bun:test";

import { canonicalJson, decodeJson1, type JsonObject, type JsonValue } from "../src/json.js";
import type { ExactComponentExit, ExactComponentProcess } from "../src/run/session.js";
import {
  ServiceHostSession,
  type ServiceHostActivation,
  type ServiceHostInvocationGate,
  type ServiceHostSessionGates,
} from "../src/service/session.js";

describe("private ServiceHostSession", () => {
  test("mounts and stops a background-only Service with no exports", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, { ...activation(), exports: [] });
    const started = service.start();
    expect(await process.nextHost()).toMatchObject({ id: "host:1", method: "service/mount" });
    process.emit(ready("provider:empty", []));
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:empty", result: {} });
    await started;
    await cleanStop(service, process);
  });

  test("mounts, admits one invocation after readiness, and stops cleanly", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    expect(await process.nextHost()).toMatchObject({ id: "host:1", method: "service/mount" });
    process.emit(ready("provider:1", ["sessions"]));
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:1", result: {} });
    await started;

    const invoked = service.invoke(invocation("read", { session: "s-1" }));
    expect(await process.nextHost()).toEqual({
      jsonrpc: "2.0",
      id: "host:2",
      method: "service/invoke",
      params: {
        export: "sessions",
        method: "read",
        input: { session: "s-1" },
        deadlineUnixMs: 4_000_000_000_000,
      },
    });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: { found: true } } });
    expect(await invoked).toEqual({ status: "succeeded", value: { found: true } });

    const stopped = service.stop();
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect(await stopped).toMatchObject({ status: "succeeded" });
  });

  test("opens readiness only after allocation, acknowledgement write, and acknowledgement persistence", async () => {
    const process = new FakeProcess();
    const before = controlled<void>();
    const after = controlled<void>();
    const beforeEntered = controlled<void>();
    const afterEntered = controlled<void>();
    const events: string[] = [];
    const service = new ServiceHostSession(process, activation(), {}, gates({
      async beforeAcknowledgement(exports) {
        events.push(`allocate:${exports.join(",")}`);
        expect(Object.isFrozen(exports)).toBe(true);
        beforeEntered.resolve();
        await before.promise;
      },
      async afterAcknowledgementWrite(exports) {
        events.push(`ack-complete:${exports.join(",")}`);
        afterEntered.resolve();
        await after.promise;
      },
    }));

    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    await beforeEntered.promise;
    expect(events).toEqual(["allocate:sessions"]);
    expect(process.writes().some(isReadinessAcknowledgement)).toBe(false);
    expect(await service.invokeDetailed(invocation("read", null))).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "OWNER_CLOSED" },
    });

    before.resolve();
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:1", result: {} });
    await afterEntered.promise;
    expect(events).toEqual(["allocate:sessions", "ack-complete:sessions"]);
    expect(await service.invokeDetailed(invocation("read", null))).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "OWNER_CLOSED" },
    });

    after.resolve();
    await started;
    await cleanStop(service, process);
  });

  test("fails closed before acknowledgement when durable generation allocation fails", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 1 }, gates({
      async beforeAcknowledgement() {
        throw new Error("generation store unavailable");
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    await expect(started).rejects.toThrow("EXECUTION_FAILED");
    expect(process.writes().some(isReadinessAcknowledgement)).toBe(false);
    expect(await service.result()).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });

  test("fences ambiguous readiness after acknowledgement bytes but before durable completion", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 1 }, gates({
      async afterAcknowledgementWrite() {
        throw new Error("ack completion was not durable");
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:1", result: {} });
    await expect(started).rejects.toThrow("EXECUTION_FAILED");
    expect(process.writes().some(isReadinessAcknowledgement)).toBe(true);
    expect(await service.invokeDetailed(invocation("read", null))).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "OWNER_CLOSED" },
    });
    expect(await service.result()).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });

  test("treats a rejected acknowledgement write as ambiguous and skips durable completion", async () => {
    const process = new FakeProcess();
    const events: string[] = [];
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 1 }, gates({
      async beforeAcknowledgement() {
        events.push("allocated");
      },
      async afterAcknowledgementWrite() {
        events.push("ack-complete");
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.rejectNextWrite(new Error("transport completion was ambiguous"));
    process.emit(ready("provider:1", ["sessions"]));
    await expect(started).rejects.toThrow("CHANNEL_LOST");
    expect(events).toEqual(["allocated"]);
    expect(await service.invokeDetailed(invocation("read", null))).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "OWNER_CLOSED" },
    });
    expect(await service.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("accepts an immediate Mount terminal after the acknowledgement while readiness becomes durable", async () => {
    const process = new FakeProcess();
    const persist = controlled<void>();
    const persistEntered = controlled<void>();
    const service = new ServiceHostSession(process, activation(), {}, gates({
      async afterAcknowledgementWrite() {
        persistEntered.resolve();
        await persist.promise;
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    expect(await process.nextHost()).toEqual({ jsonrpc: "2.0", id: "provider:1", result: {} });
    await persistEntered.promise;

    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    persist.resolve();
    await started;
    expect(await service.result()).toMatchObject({ status: "succeeded" });
  });

  test("keeps the startup bound active while an immediate terminal waits on acknowledgement durability", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    let aborted = false;
    const service = new ServiceHostSession(process, {
      ...activation(),
      startupDeadlineUnixMs: Date.now() + 25,
    }, { cancellationGraceMs: 1 }, gates({
      async afterAcknowledgementWrite(_exports, signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        aborted = true;
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    await process.nextHost();
    await entered.promise;
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    await expect(started).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(aborted).toBe(true);
    expect(await service.result()).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
  });

  test("preserves an initialization-error Mount terminal across delayed cleanup", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, {
      ...activation(),
      startupDeadlineUnixMs: Date.now() + 15,
    });
    const started = service.start();
    await process.nextHost();
    process.emit({
      jsonrpc: "2.0",
      id: "host:1",
      error: {
        code: -32000,
        message: "Provider initialization was denied",
        data: { code: "PERMISSION_DENIED" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    process.finish(0);
    await expect(started).rejects.toThrow("PERMISSION_DENIED");
    expect(await service.result()).toMatchObject({
      status: "failed",
      code: "PERMISSION_DENIED",
      message: "Provider initialization was denied",
    });
  });

  test("does not re-arm startup after an initialization error races Mount-write completion", async () => {
    const process = new FakeProcess();
    const releaseWrite = controlled<void>();
    process.holdNextWriteUntil(releaseWrite.promise);
    const service = new ServiceHostSession(process, {
      ...activation(),
      startupDeadlineUnixMs: Date.now() + 20,
    });
    const started = service.start();
    await process.nextHost();
    process.emit({
      jsonrpc: "2.0",
      id: "host:1",
      error: {
        code: -32000,
        message: "Provider could not initialize",
        data: { code: "UNAVAILABLE" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1));
    releaseWrite.resolve();
    await new Promise((resolve) => setTimeout(resolve, 45));
    process.finish(0);
    await expect(started).rejects.toThrow("UNAVAILABLE");
    expect(await service.result()).toMatchObject({
      status: "failed",
      code: "UNAVAILABLE",
      message: "Provider could not initialize",
    });
  });

  test("does not reopen readiness when stop races a normally resolving post-ack gate", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    const release = controlled<void>();
    const service = new ServiceHostSession(process, activation(), {}, gates({
      async afterAcknowledgementWrite(_exports, signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await release.promise;
      },
    }));
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["sessions"]));
    await process.nextHost();
    await entered.promise;
    const stopped = service.stop();
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    release.resolve();
    await expect(started).rejects.toThrow("ended before readiness");
    expect(await stopped).toMatchObject({ status: "succeeded" });
  });

  test("aborts every readiness gate on a malformed Provider frame", async () => {
    for (const stage of ["before", "after"] as const) {
      const process = new FakeProcess();
      const entered = controlled<void>();
      const exited = controlled<void>();
      const block = async (signal: AbortSignal): Promise<void> => {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        exited.resolve();
      };
      const service = new ServiceHostSession(process, activation(), {}, gates({
        ...(stage === "before" ? {
          beforeAcknowledgement: async (_exports, signal) => block(signal),
        } : {
          afterAcknowledgementWrite: async (_exports, signal) => block(signal),
        }),
      }));
      const started = service.start();
      await process.nextHost();
      process.emit(ready("provider:1", ["sessions"]));
      if (stage === "after") await process.nextHost();
      await entered.promise;
      process.emit(malformedCancellation());
      await exited.promise;
      await expect(started).rejects.toThrow("PROTOCOL_ERROR");
      expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
    }
  });

  test("runs the durable dispatch gate directly before the first invocation frame byte", async () => {
    const process = new FakeProcess();
    const dispatch = controlled<void>();
    const entered = controlled<void>();
    const seen: string[] = [];
    const service = new ServiceHostSession(process, activation(), {}, gates());
    const gate = invocationGate({
      async beforeDispatch() {
        seen.push("allocation-one");
        entered.resolve();
        await dispatch.promise;
      },
    });
    await startReady(service, process);
    const invoked = service.invokeDetailed(invocation("read", { key: "one" }), gate);
    await entered.promise;
    expect(seen).toEqual(["allocation-one"]);
    expect(process.writes().some(isInvocation)).toBe(false);
    dispatch.resolve();
    expect(await process.nextHost()).toMatchObject({ id: "host:2", method: "service/invoke" });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "ok" } });
    expect(await invoked).toEqual({
      source: "provider-response",
      terminal: { status: "succeeded", value: "ok" },
    });
    await cleanStop(service, process);
  });

  test("records a rejected dispatch gate as host-prewrite without losing the Provider", async () => {
    const process = new FakeProcess();
    let reject = true;
    const service = new ServiceHostSession(process, activation(), {}, gates());
    await startReady(service, process);
    expect(await service.invokeDetailed(invocation("read", "not-sent"), invocationGate({
      async beforeDispatch() {
        if (reject) throw new Error("invocation record unavailable");
      },
    }))).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "UNAVAILABLE" },
    });
    expect(process.writes().some(isInvocation)).toBe(false);

    reject = false;
    const invoked = service.invokeDetailed(invocation("read", "sent"), invocationGate({
      async beforeDispatch() {
        if (reject) throw new Error("invocation record unavailable");
      },
    }));
    expect(await process.nextHost()).toMatchObject({ method: "service/invoke", params: { input: "sent" } });
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: null } });
    expect((await invoked).source).toBe("provider-response");
    await cleanStop(service, process);
  });

  test("keeps identical concurrent invocation allocations correlated by their per-call gates", async () => {
    const process = new FakeProcess();
    const firstGate = controlled<void>();
    const secondGate = controlled<void>();
    const entered: string[] = [];
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);

    const request = invocation("read", { same: true });
    const first = service.invokeDetailed(request, invocationGate({
      async beforeDispatch() {
        entered.push("allocation-a");
        await firstGate.promise;
      },
    }));
    const second = service.invokeDetailed(request, invocationGate({
      async beforeDispatch() {
        entered.push("allocation-b");
        await secondGate.promise;
      },
    }));
    await until(() => entered.length === 1);
    expect(entered).toEqual(["allocation-a"]);
    expect(process.writes().some(isInvocation)).toBe(false);
    firstGate.resolve();
    expect(await process.nextHost()).toMatchObject({ id: "host:2", method: "service/invoke" });
    await until(() => entered.length === 2);
    expect(entered).toEqual(["allocation-a", "allocation-b"]);
    secondGate.resolve();
    expect(await process.nextHost()).toMatchObject({ id: "host:3", method: "service/invoke" });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "a" } });
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "b" } });
    expect(await first).toMatchObject({ source: "provider-response", terminal: { value: "a" } });
    expect(await second).toMatchObject({ source: "provider-response", terminal: { value: "b" } });
    await cleanStop(service, process);
  });

  test("waits for cancellation-aware dispatch-gate quiescence before closing prewrite work", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    const quiesce = controlled<void>();
    const observations: string[] = [];
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const cancellation = new AbortController();
    const invoked = service.invokeDetailed(
      { ...invocation("read", "never-dispatched"), signal: cancellation.signal },
      invocationGate({
        async beforeDispatch(signal) {
          expect(signal).not.toBe(cancellation.signal);
          entered.resolve();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          observations.push("aborted");
          await quiesce.promise;
          observations.push("quiesced");
        },
      }),
    );
    await entered.promise;
    let terminalVisible = false;
    void invoked.then(() => {
      terminalVisible = true;
    });
    cancellation.abort();
    await until(() => observations.includes("aborted"));
    expect(terminalVisible).toBe(false);
    expect(process.writes().some(isInvocation)).toBe(false);
    quiesce.resolve();
    expect(await invoked).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "CANCELLED" },
    });
    expect(observations).toEqual(["aborted", "quiesced"]);
    expect(process.writes().some(isInvocation)).toBe(false);
    await cleanStop(service, process);
  });

  test("aborts and drains a dispatch gate before protocol failure can settle", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    const exited = controlled<void>();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const invoked = service.invokeDetailed(invocation("read", "malformed"), invocationGate({
      async beforeDispatch(signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        exited.resolve();
      },
    }));
    await entered.promise;
    process.emit(malformedCancellation());
    await exited.promise;
    expect(await invoked).toMatchObject({ source: "host-prewrite" });
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
    expect(process.writes().some(isInvocation)).toBe(false);
  });

  test("aborts Host-only prewrite work when the Provider ends its Mount", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    let gateAborted = false;
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const invoked = service.invokeDetailed(invocation("read", "terminal"), invocationGate({
      async beforeDispatch(signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        gateAborted = true;
      },
    }));
    await entered.promise;
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect(await invoked).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "OWNER_CLOSED" },
    });
    expect(gateAborted).toBe(true);
    expect(await service.result()).toMatchObject({ status: "succeeded" });
    expect(process.writes().some(isInvocation)).toBe(false);
  });

  test("aborts and drains a prewrite gate before stop can settle the Mount", async () => {
    const process = new FakeProcess();
    const entered = controlled<void>();
    const gateStopped = controlled<void>();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const invoked = service.invokeDetailed(invocation("read", "stop"), invocationGate({
      async beforeDispatch(signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        gateStopped.resolve();
      },
    }));
    await entered.promise;
    const stopped = service.stop();
    await gateStopped.promise;
    expect(await invoked).toMatchObject({
      source: "host-prewrite",
      terminal: { status: "failed", code: "CANCELLED" },
    });
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect(await stopped).toMatchObject({ status: "succeeded" });
    expect(process.writes().some(isInvocation)).toBe(false);
  });

  test("distinguishes Provider response, cooperative cancellation, and Provider loss", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), {}, gates());
    await startReady(service, process);

    const responded = service.invokeDetailed(invocation("read", "response"));
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: 1 } });
    expect(await responded).toEqual({
      source: "provider-response",
      terminal: { status: "succeeded", value: 1 },
    });

    const cancellation = new AbortController();
    const cancelled = service.invokeDetailed({
      ...invocation("read", "cancel"),
      signal: cancellation.signal,
    });
    await process.nextHost();
    cancellation.abort();
    expect(await process.nextHost()).toEqual(cancel("host:3"));
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "settled" } });
    expect(await cancelled).toMatchObject({
      source: "cooperative-cancellation",
      terminal: { status: "failed", code: "CANCELLED" },
    });

    const lost = service.invokeDetailed(invocation("read", "lost"));
    await process.nextHost();
    process.finish(9);
    expect(await lost).toMatchObject({
      source: "provider-loss",
      terminal: { status: "failed", code: "UNCERTAIN" },
    });
    expect(await service.result()).toMatchObject({ status: "failed" });
  });

  test("treats a failed invocation write as possible dispatch", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);

    process.rejectNextWrite(new Error("write outcome unknown"));
    const invoked = await service.invokeDetailed(invocation("read", "ambiguous"));

    expect(invoked).toEqual({
      source: "provider-loss",
      terminal: {
        status: "failed",
        code: "UNCERTAIN",
        message: "Service invocation may have been dispatched before the channel failed: write outcome unknown",
      },
    });
    expect(await service.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("does not let cancellation hide loss after possible dispatch", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const cancellation = new AbortController();

    const invoked = service.invokeDetailed({
      ...invocation("read", "possibly-applied"),
      signal: cancellation.signal,
    });
    expect(await process.nextHost()).toMatchObject({ id: "host:2", method: "service/invoke" });
    cancellation.abort();
    expect(await process.nextHost()).toEqual(cancel("host:2"));
    process.finish(9);

    expect(await invoked).toEqual({
      source: "provider-loss",
      terminal: {
        status: "failed",
        code: "UNCERTAIN",
        message: "Service invocation may have completed before Provider loss",
      },
    });
    expect(await service.result()).toMatchObject({ status: "failed" });
  });

  test("keeps Provider loss during dispatch gating safely prewrite", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const entered = controlled<void>();
    let gateAborted = false;

    const invoked = service.invokeDetailed(invocation("read", "never-written"), invocationGate({
      async beforeDispatch(signal) {
        entered.resolve();
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
        gateAborted = true;
      },
    }));
    await entered.promise;
    process.finish(9);

    expect(await invoked).toEqual({
      source: "host-prewrite",
      terminal: {
        status: "failed",
        code: "UNAVAILABLE",
        message: "Service Provider was lost before invocation dispatch",
      },
    });
    expect(gateAborted).toBe(true);
    expect(process.writes().some(isInvocation)).toBe(false);
    expect(await service.result()).toMatchObject({ status: "failed" });
  });

  test("rejects a readiness set that differs from admission", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit(ready("provider:1", ["documents"]));
    expect(await process.nextHost()).toMatchObject({ id: "provider:1", error: { code: -32602 } });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("rejects wrong-owner, duplicate, and unsorted readiness", async () => {
    const invalid = [
      { ownerRequestId: "host:2", exports: ["sessions"] },
      { ownerRequestId: "host:1", exports: ["sessions", "sessions"] },
      { ownerRequestId: "host:1", exports: ["sessions", "documents"] },
    ];
    for (const [index, params] of invalid.entries()) {
      const process = new FakeProcess();
      const service = new ServiceHostSession(process, activation());
      const started = service.start();
      await process.nextHost();
      process.emit({ jsonrpc: "2.0", id: `provider:${index + 1}`, method: "service/ready", params });
      expect(await process.nextHost()).toMatchObject({ error: { code: -32602 } });
      await expect(started).rejects.toThrow("PROTOCOL_ERROR");
      expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
    }
  });

  test("rejects a second readiness after admission", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    process.emit(ready("provider:2", ["sessions"]));
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("accepts an exactly 16 MiB Provider frame", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emitBytes(paddedJsonFrame(ready("provider:1", ["sessions"]), 16_777_216));
    await process.nextHost();
    await started;
    await cleanStop(service, process);
  });

  test("rejects a Provider frame one byte over 16 MiB", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emitBytes(paddedJsonFrame(ready("provider:1", ["sessions"]), 16_777_217));
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("accepts mount-owned calls before readiness and scopes operation reuse", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    const first = providerEffect("provider:1", "host:1", "open:1", null);
    process.emit(first);
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit({ ...first, id: "provider:2" });
    expect(operationCode(await process.nextHost())).toBe("UNAVAILABLE");
    process.emit(providerEffect("provider:3", "host:1", "open:1", { changed: true }));
    expect(operationCode(await process.nextHost())).toBe("OPERATION_CONFLICT");
    process.emit(providerEffect("provider:4", "host:unknown", "open:1", null));
    expect(operationCode(await process.nextHost())).toBe("OWNER_CLOSED");
    process.emit(ready("provider:5", ["sessions"]));
    await process.nextHost();
    await started;
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(0);
    expect((await stopped).status).toBe("succeeded");
  });

  test("keeps unknown Provider requests local but closes on malformed cancellation", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "provider:1", method: "unknown/request", params: {} });
    expect(await process.nextHost()).toMatchObject({ id: "provider:1", error: { code: -32601 } });
    process.emit({
      jsonrpc: "2.0",
      method: "request/cancel",
      params: { requestId: "host:1", extra: true },
    });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("closes after the 65,536-request Provider lifetime", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    for (let index = 1; index <= 65_536; index += 1) {
      const id = `provider:lifetime:${index}`;
      process.emit({ jsonrpc: "2.0", id, method: "unknown/request", params: {} });
      expect(await process.nextHost()).toMatchObject({ id, error: { code: -32601 } });
    }
    process.emit({
      jsonrpc: "2.0",
      id: "provider:lifetime:65537",
      method: "unknown/request",
      params: {},
    });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  }, 120_000);

  test("settles concurrent invocations out of order", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const first = service.invoke(invocation("read", "first"));
    const second = service.invoke(invocation("read", "second"));
    expect((await process.nextHost() as JsonObject).id).toBe("host:2");
    expect((await process.nextHost() as JsonObject).id).toBe("host:3");
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "second" } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { error: { name: "not-found", data: null } } });
    expect(await second).toEqual({ status: "succeeded", value: "second" });
    expect(await first).toEqual({ status: "application-error", name: "not-found", data: null });
    await cleanStop(service, process);
  });

  test("admits at most 63 invocations beside the pending Mount", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const pending = Array.from({ length: 63 }, (_, index) => service.invoke(invocation("read", index)));
    for (let index = 0; index < pending.length; index += 1) {
      expect(await process.nextHost()).toMatchObject({ id: `host:${index + 2}`, method: "service/invoke" });
    }
    expect(await service.invoke(invocation("read", "overflow"))).toMatchObject({
      status: "failed",
      code: "RESOURCE_EXHAUSTED",
    });
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      process.emit({ jsonrpc: "2.0", id: `host:${index + 2}`, result: { value: index } });
    }
    expect(await Promise.all(pending)).toHaveLength(63);
    await cleanStop(service, process);
  });

  test("cancels one invocation without cancelling its sibling", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 100 });
    await startReady(service, process);
    const controller = new AbortController();
    const slow = service.invoke({ ...invocation("read", "slow"), signal: controller.signal });
    const fast = service.invoke(invocation("read", "fast"));
    await process.nextHost();
    await process.nextHost();
    controller.abort();
    expect(await process.nextHost()).toEqual(cancel("host:2"));
    process.emit({ jsonrpc: "2.0", id: "host:3", result: { value: "fast" } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "too-late" } });
    expect(await fast).toEqual({ status: "succeeded", value: "fast" });
    expect(await slow).toMatchObject({ status: "failed", code: "CANCELLED" });
    await cleanStop(service, process);
  });

  test("lets a committed invocation result win later cancellation", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const controller = new AbortController();
    const invoked = service.invoke({ ...invocation("read", null), signal: controller.signal });
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "committed" } });
    expect(await invoked).toEqual({ status: "succeeded", value: "committed" });
    controller.abort();
    await cleanStop(service, process);
  });

  test("keeps the first deadline decision when a response arrives later", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), { cancellationGraceMs: 100 });
    await startReady(service, process);
    const invoked = service.invoke({ ...invocation("read", null), deadlineUnixMs: Date.now() + 10 });
    await process.nextHost();
    expect(await process.nextHost()).toEqual(cancel("host:2"));
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: "too-late" } });
    expect(await invoked).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
    await cleanStop(service, process);
  });

  test("rejects stale invocation ownership without losing the Mount", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const invoked = service.invoke(invocation("read", null));
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await invoked;
    process.emit(providerEffect("provider:2", "host:2", "late:1", null));
    expect(operationCode(await process.nextHost())).toBe("OWNER_CLOSED");
    await cleanStop(service, process);
  });

  test("treats mount success before readiness as a protocol failure", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    const started = service.start();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    await expect(started).rejects.toThrow("PROTOCOL_ERROR");
    expect(await service.result()).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("does not report Mount success after an unclean process exit", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.finish(7);
    expect(await stopped).toMatchObject({ status: "failed", code: "EXECUTION_FAILED" });
  });

  test("invalidates Mount success after a trailing frame", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emit({ jsonrpc: "2.0", method: "unknown/event", params: {} });
    expect(await stopped).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("invalidates Mount success after an incomplete trailing frame", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emitBytes(new TextEncoder().encode("{\"jsonrpc\":\"2.0\"}"));
    process.finish(0);
    expect(await stopped).toMatchObject({ status: "failed", code: "PROTOCOL_ERROR" });
  });

  test("classifies process loss before readiness as channel loss", async () => {
    const clean = new FakeProcess();
    const cleanService = new ServiceHostSession(clean, activation());
    const cleanStart = cleanService.start();
    await clean.nextHost();
    clean.finish(0);
    await expect(cleanStart).rejects.toThrow("CHANNEL_LOST");
    expect(await cleanService.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });

    const unclean = new FakeProcess();
    const uncleanService = new ServiceHostSession(unclean, activation());
    const uncleanStart = uncleanService.start();
    await unclean.nextHost();
    unclean.finish(9);
    await expect(uncleanStart).rejects.toThrow("CHANNEL_LOST");
    expect(await uncleanService.result()).toMatchObject({ status: "failed", code: "CHANNEL_LOST" });
  });

  test("enforces the startup deadline and terminates an unready Provider", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, {
      ...activation(),
      startupDeadlineUnixMs: Date.now() + 10,
    }, { cancellationGraceMs: 1 });
    const started = service.start();
    await process.nextHost();
    await expect(started).rejects.toThrow("DEADLINE_EXCEEDED");
    expect(await process.nextHost()).toEqual(cancel("host:1"));
    expect(await service.result()).toMatchObject({ status: "failed", code: "DEADLINE_EXCEEDED" });
  });

  test("invalidates Mount success when diagnostics exceed the host budget", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation(), {
      stderrBytes: 4,
      capturedStderrBytes: 3,
    });
    await startReady(service, process);
    const stopped = service.stop();
    await process.nextHost();
    process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
    process.emitStderr(new TextEncoder().encode("diagnostic"));
    expect(await stopped).toMatchObject({
      status: "failed",
      code: "RESOURCE_EXHAUSTED",
      diagnostics: { stderr: "dia", stderrBytes: 10, stderrTruncated: true },
    });
  });

  test("snapshots activation and invocation values before delayed transport", async () => {
    const process = new FakeProcess();
    const mutableSettings = { mode: "original" };
    const mutableActivation = {
      ...activation(),
      settings: mutableSettings,
      exports: ["sessions"],
    };
    const service = new ServiceHostSession(process, mutableActivation);
    mutableSettings.mode = "changed";
    mutableActivation.exports[0] = "documents";
    const started = service.start();
    expect(await process.nextHost()).toMatchObject({
      params: { settings: { mode: "original" } },
    });
    process.emit(ready("provider:1", ["sessions"]));
    await process.nextHost();
    await started;

    const input = { key: "original" };
    const invoked = service.invoke(invocation("read", input));
    input.key = "changed";
    expect(await process.nextHost()).toMatchObject({ params: { input: { key: "original" } } });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await invoked;
    await cleanStop(service, process);
  });

  test("does not dispatch an invocation already cancelled or expired", async () => {
    const process = new FakeProcess();
    const service = new ServiceHostSession(process, activation());
    await startReady(service, process);
    const controller = new AbortController();
    controller.abort();
    expect(await service.invoke({ ...invocation("read", null), signal: controller.signal })).toMatchObject({
      status: "failed",
      code: "CANCELLED",
    });
    expect(await service.invoke({ ...invocation("read", null), deadlineUnixMs: 0 })).toMatchObject({
      status: "failed",
      code: "DEADLINE_EXCEEDED",
    });

    const valid = service.invoke(invocation("read", null));
    expect(await process.nextHost()).toMatchObject({ id: "host:2", method: "service/invoke" });
    process.emit({ jsonrpc: "2.0", id: "host:2", result: { value: null } });
    await valid;
    await cleanStop(service, process);
  });
});

function activation(): ServiceHostActivation {
  return {
    settings: {},
    attachments: {},
    scratch: "/scratch",
    startupDeadlineUnixMs: 4_000_000_000_000,
    exports: ["sessions"],
  };
}

function invocation(method: string, input: JsonValue) {
  return {
    exportName: "sessions",
    method,
    input,
    deadlineUnixMs: 4_000_000_000_000,
  } as const;
}

function gates(overrides: Partial<ServiceHostSessionGates> = {}): ServiceHostSessionGates {
  return {
    async beforeAcknowledgement(): Promise<void> {},
    async afterAcknowledgementWrite(): Promise<void> {},
    ...overrides,
  };
}

function invocationGate(overrides: Partial<ServiceHostInvocationGate> = {}): ServiceHostInvocationGate {
  return {
    async beforeDispatch(): Promise<void> {},
    ...overrides,
  };
}

function controlled<T>(): {
  readonly promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value?: T): void {
      resolvePromise(value as T);
    },
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("condition was not reached");
}

function isReadinessAcknowledgement(value: JsonValue): boolean {
  return value !== null
    && !Array.isArray(value)
    && typeof value === "object"
    && (value as JsonObject).id === "provider:1"
    && Object.hasOwn(value, "result");
}

function isInvocation(value: JsonValue): boolean {
  return value !== null
    && !Array.isArray(value)
    && typeof value === "object"
    && (value as JsonObject).method === "service/invoke";
}

async function startReady(service: ServiceHostSession, process: FakeProcess): Promise<void> {
  const started = service.start();
  await process.nextHost();
  process.emit(ready("provider:1", ["sessions"]));
  await process.nextHost();
  await started;
}

async function cleanStop(service: ServiceHostSession, process: FakeProcess): Promise<void> {
  const stopped = service.stop();
  expect(await process.nextHost()).toEqual(cancel("host:1"));
  process.emit({ jsonrpc: "2.0", id: "host:1", result: {} });
  process.finish(0);
  expect((await stopped).status).toBe("succeeded");
}

function ready(id: string, exports: readonly string[]): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "service/ready",
    params: { ownerRequestId: "host:1", exports: [...exports] },
  };
}

function providerEffect(
  id: string,
  ownerRequestId: string,
  operationId: string,
  input: JsonValue,
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    method: "effect/call",
    params: {
      ownerRequestId,
      operationId,
      slot: "storage",
      method: "read",
      input,
    },
  };
}

function cancel(requestId: string): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId } };
}

function malformedCancellation(): JsonObject {
  return { jsonrpc: "2.0", method: "request/cancel", params: { requestId: "host:1", extra: true } };
}

function operationCode(value: JsonValue): string {
  return (((value as JsonObject).error as JsonObject).data as JsonObject).code as string;
}

function paddedJsonFrame(value: JsonValue, payloadBytes: number): Uint8Array {
  const encoded = canonicalJson(value);
  if (encoded.byteLength > payloadBytes) throw new Error("value exceeds requested frame size");
  const frame = new Uint8Array(payloadBytes + 1);
  frame.fill(0x20);
  frame.set(encoded);
  frame[payloadBytes] = 0x0a;
  return frame;
}

class FakeProcess implements ExactComponentProcess {
  readonly stdout = new BytePipe();
  readonly stderr = new BytePipe();
  readonly completion: Promise<ExactComponentExit>;
  private readonly host = new ValuePipe();
  private readonly writtenValues: JsonValue[] = [];
  private readonly complete: (exit: ExactComponentExit) => void;
  private nextWriteFailure?: Error;
  private nextWriteHold?: Promise<void>;
  private finished = false;

  constructor() {
    let complete!: (exit: ExactComponentExit) => void;
    this.completion = new Promise((resolve) => {
      complete = resolve;
    });
    this.complete = complete;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.finished) throw new Error("process already exited");
    if (bytes.at(-1) !== 0x0a) throw new Error("host write is not framed");
    if (this.nextWriteFailure !== undefined) {
      const error = this.nextWriteFailure;
      this.nextWriteFailure = undefined;
      throw error;
    }
    const value = decodeJson1(bytes.subarray(0, -1));
    this.writtenValues.push(value);
    this.host.push(value);
    const hold = this.nextWriteHold;
    this.nextWriteHold = undefined;
    await hold;
  }

  async closeInput(): Promise<void> {}

  async terminate(): Promise<void> {
    this.finish(null, "SIGKILL");
  }

  async nextHost(): Promise<JsonValue> {
    return this.host.next();
  }

  writes(): readonly JsonValue[] {
    return this.writtenValues;
  }

  rejectNextWrite(error: Error): void {
    this.nextWriteFailure = error;
  }

  holdNextWriteUntil(release: Promise<void>): void {
    this.nextWriteHold = release;
  }

  emit(value: JsonValue): void {
    const bytes = canonicalJson(value);
    const frame = new Uint8Array(bytes.byteLength + 1);
    frame.set(bytes);
    frame[bytes.byteLength] = 0x0a;
    this.stdout.push(frame);
  }

  emitBytes(bytes: Uint8Array): void {
    this.stdout.push(bytes);
  }

  emitStderr(bytes: Uint8Array): void {
    this.stderr.push(bytes);
  }

  finish(exitCode: number | null, signal: string | null = null): void {
    if (this.finished) return;
    this.finished = true;
    this.stdout.end();
    this.stderr.end();
    this.complete({ exitCode, signal, fenced: true });
  }
}

class BytePipe implements AsyncIterable<Uint8Array> {
  private readonly values: Uint8Array[] = [];
  private readonly waiters: Array<(value: IteratorResult<Uint8Array>) => void> = [];
  private ended = false;

  push(value: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter({ done: false, value });
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value !== undefined) return { done: false, value };
        if (this.ended) return { done: true, value: undefined };
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

class ValuePipe {
  private readonly values: JsonValue[] = [];
  private readonly waiters: Array<(value: JsonValue) => void> = [];

  push(value: JsonValue): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter(value);
  }

  async next(): Promise<JsonValue> {
    const value = this.values.shift();
    if (value !== undefined) return value;
    return Promise.race([
      new Promise<JsonValue>((resolve) => this.waiters.push(resolve)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("host write timeout")), 1_000)),
    ]);
  }
}

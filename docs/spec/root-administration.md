# Jig Root Administration/1

**Status:** closed candidate for the first consumer-facing Jig administration
slice. This document fixes the interface before a controller or probe consumes
it; it does not claim publication or define an IPC transport.

## 1. Authority and construction

The TypeScript entry point is `@jigging/jig/administration`. A trusted Jig host
hands application code one `RootAdministration` object for one already-open
project. Possession of that object is the in-process authority to submit and
inspect root Runs for that project.

The package exposes no constructor, `openProject`, project path, daemon
locator, credential, or ambient singleton. A future CLI, GUI, or remote client
must authenticate its own transport and project selection before receiving an
equivalent authority. Those concerns are not hidden inside this interface.

## 2. Complete surface

```ts
interface RootAdministration {
  startRun(request: StartRootRunRequest): Promise<StartRootRunReceipt>;
  runStatus(request: RootRunStatusRequest): Promise<RootRunStatus>;
}
```

There is no list, watch, cancel, retry, delete, plan, apply, Service, Hook,
Agent, semantic-choice, or provider-management method in this slice.

`startRun` accepts exactly:

```ts
interface StartRootRunRequest {
  submissionId: string;
  target: FlowRef | BindingRef;
  input: JsonValue;
}
```

The caller cannot set a deadline, settings, attachments, environment,
permissions, grants, runtime, Sandbox Backend, Agent, admission generation, or
retry policy. These are admitted project and host policy, not per-Run escape
hatches.

The receipt contains only the durable `runId`. `runStatus({ runId })` returns
the immutable submission identity and either `pending` or one final terminal.
`pending` does not claim that package code has started; it means no terminal is
durably published yet.

## 3. Idempotency and validation

The host validates bounded FLOW JSON/1 before allocation. Invalid JSON/1 or an
invalid closed request produces `INVALID_REQUEST` and allocates no Run.

`submissionId` is opaque and project-local. Repeating the same ID with the
same target and input returns the original `runId` without consulting newer
policy or dispatching again. Reusing it for different target or input produces
`SUBMISSION_CONFLICT`.

A structurally valid request to an unknown, unavailable, revoked, or
schema-incompatible admitted target still receives a durable Run. That Run
terminates with the appropriate failure, including `UNAVAILABLE` or
`INVALID_INPUT`; these are Run outcomes, not administration exceptions.

## 4. Status and terminals

The status states are closed:

```text
pending
terminal
```

Terminals are closed:

```text
succeeded   outcome + output + diagnostics
failed      Run failure code + message + optional details + diagnostics
lost        COORDINATOR_LOST + message
```

Status does not expose admission digests, candidate revisions, coordinator
epochs, process IDs, cgroup paths, runtime paths, Sandbox Backend receipts, or
mutable internal records. Later authority inspection is a separate read model,
not extra fields smuggled into this one.

## 5. Administration errors

`RootAdministrationError.code` is exactly one of:

```text
INVALID_REQUEST
SUBMISSION_CONFLICT
RUN_NOT_FOUND
PROJECT_BUSY
PROJECT_CLOSED
UNAVAILABLE
INTERNAL
```

Applications branch on `code`, never the human message. `details`, when
present, is FLOW JSON/1. Run failures are not converted into administration
errors.

## 6. Machine contract

[`root-administration-1.schema.json`](machine/root-administration-1.schema.json)
contains closed structural definitions for both requests, the receipt, status,
terminals, and the serializable error projection. Schema/1 deliberately has no
regular-expression keyword, so `submissionId`, `runId`, LocalName, and project
path syntax receive their final check in the SDK normalizer. The TypeScript and
schema branches otherwise evolve together.

This interface is an object-capability API, not JSON-RPC. Reusing the schema in
a future transport does not define authentication, framing, ordering, or
method names for that transport.

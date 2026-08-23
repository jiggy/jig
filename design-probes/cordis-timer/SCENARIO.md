# Scenario: realm-local timers, portable scheduler boundary

## User story

Mira schedules a short reminder through a Python Flow. A Bun FLOW Service uses
the existing Cordis Timer component to own the native timer. When it fires, the
Service publishes one durable `timer-fired` Event through its fixed Journal
Binding. A Jig Hook starts a Python recorder Run.

## Desired tree

```text
cordis-timer/
├── jig.ts
├── bindings/
│   ├── cordis-scheduler.ts
│   ├── journal.ts
│   ├── record-firing.ts
│   └── schedule-reminder.ts
├── hooks/
│   └── on-timer-fired.ts
└── flows/
    ├── cordis-scheduler/     Bun Service + real Cordis dependency
    ├── schedule-reminder/    Python Run
    └── record-firing/        Python Run
```

## Activation

1. Jig resolves exact native dependencies and prepares the Bun package under
   host Runtime/Sandbox policy.
2. The Service receives its fixed Journal dependency before initialization.
3. It creates one Cordis `Context`, mounts the unmodified Timer Service, and
   awaits it.
4. It mounts a local bridge plugin with `inject: ["timer"]`. Cordis keeps that
   plugin pending until the Timer Service exists.
5. The bridge captures realm-local scheduler functions. Only then does the
   FLOW Service expose its statically declared `scheduler` capability and
   become ready.

The probe retains at most `maxTimerRecords` single-use timer IDs for the Mount
lifetime. Reaching that explicit bound rejects new schedules rather than
silently evicting identity or growing memory without limit.

## Scheduling

1. `schedule-reminder` calls `scheduler.schedule` under one invocation-owned
   operation.
2. The bridge asks `ctx.timeout(callback, delay)` for a disposer and retains it
   in a realm-local map. Neither value crosses FLOW.
3. `schedule` returns once the timer is accepted. Its invocation owns no live
   child operation afterward.
4. Later, the callback starts `journal.append` through the Mount-owned client.
   The Event is attributed to the scheduler provider, not the old caller.
5. Hook selection and derived recorder Run use ordinary Journal semantics.

## Disposal and loss

Cancelling the Service Mount first closes invocation admission, then disposes
the root Cordis Fiber. Timer disposers clear pending native timers. Outstanding
Mount-owned Journal calls are cancelled or resolved before the Mount response
can terminate.

Process loss loses all pending timers and exact scheduler generation. A new
Mount starts empty. No consumer or timer handle heals across it.

## Replacement

The Service has no attachment conflict, but a Hook selects it as an Event
source. The reviewed conservative replacement rule therefore drains and
fences the old source before switching Hook intervals and starting the new
Mount. Pending timers cancelled by disposal do not migrate.

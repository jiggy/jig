---
name: cordis-scheduler
description: Schedule process-local timers through an unmodified Cordis Timer component.
service: 1
uses:
  journal:
    contract: ./contracts/journal.capability.json
provides:
  scheduler: ./contracts/scheduler.capability.json
---

# Cordis scheduler adapter

Create one Cordis realm, mount the published Timer Service unchanged, and
expose a bounded JSON scheduler interface. Native callbacks, Context, Fibers,
Services, and disposers remain inside the realm.

Accepted timers are process-local and single-use for this Mount. They do not
survive provider loss or replacement. A timer callback publishes one
`timer-fired` fact through Mount-owned Journal authority. The scheduling
invocation has already completed and does not own that later effect.

Cancellation of the FLOW Mount disposes the root Cordis Fiber, which clears
pending timers before the Service acknowledges cleanup.


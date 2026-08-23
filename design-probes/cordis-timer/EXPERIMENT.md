# Existing Cordis component reuse probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> The Cordis dependency is real. Jig/FLOW SDKs and their adapter code are
> coherent pseudocode. This is not a compatibility promise or implementation.

## Question under test

Can an existing unmodified Cordis component run behind FLOW Service/1 while
Cordis retains its own dependency, effect, callback, and disposal semantics?

The chosen component is the official disposal-aware
`@cordisjs/plugin-timer` package. It is useful because its API contains native
callbacks and timers which cannot cross FLOW's JSON boundary honestly.

The probe:

1. creates one Cordis realm inside one Bun FLOW Service;
2. mounts the existing Timer Service unchanged;
3. mounts one local bridge plugin which declares `inject: ["timer"]`;
4. translates JSON scheduler calls into realm-local timer callbacks;
5. publishes timer-fired facts through the Service's fixed Journal Binding;
6. exposes one fixed scheduler Capability Contract;
7. cancels all timers through Cordis root disposal; and
8. reacts to committed facts through one ordinary Jig Hook and Python Run.

It does not claim Cordis, DSH, GUI-plugin, or arbitrary object portability.

## Falsification rules

The design fails if it requires:

- changing the existing Timer source;
- serializing a callback, Cordis Context, Fiber, disposer, or Service object;
- Jig awareness of Cordis service keys or plugin lifecycle;
- a Cordis-specific FLOW protocol method;
- transferring invocation ownership into a later timer callback;
- hidden provider restart or rebinding; or
- a dynamic FLOW dependency/export merely because Cordis is dynamic locally.

## Findings from the first tabletop pass

- One realm maps cleanly to one pending Service Mount. Root Fiber disposal is
  the only cross-boundary cleanup operation needed.
- Cordis callbacks remain local. The exported FLOW interface is ordinary
  bounded request/response JSON.
- A scheduled timer is provider-owned application state after `schedule`
  returns. Its later Journal append is Mount-owned work, not child work
  falsely attributed to the completed caller invocation.
- Losing the Mount loses pending timers. This scheduler intentionally promises
  no persistence or transparent recovery.
- Cordis injection does not justify dynamic FLOW dependencies. Fixed external
  bindings can be installed before realm construction; internal services may
  remain reactive inside Cordis.
- The adapter also needs no post-readiness export mutation. Loss of a required
  public realm service should fail the Mount rather than heal consumers through
  a new invisible generation.

Those last two findings supplied the final evidence used to remove dynamic
Service Binding snapshots and post-readiness export mutation from reviewed v1.

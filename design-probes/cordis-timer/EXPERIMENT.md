# Minimal Cordis component reuse probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> The Cordis dependencies and APIs are real. Jig and FLOW SDKs are future
> surfaces represented by coherent pseudocode.

## Question under test

Can an existing unmodified Cordis component provide one useful FLOW Service/1
operation without making Jig understand Cordis or recreating a plugin system at
the boundary?

The probe creates one Cordis realm inside one Bun FLOW Service, installs the
published Timer Service unchanged, and exposes one serializable method:

```text
wait({ delayMs }) -> { completed: true }
```

One small Python Run calls that Service. The invocation remains pending while
the native timer exists, so there is no timer identity, background callback,
Journal publication, Hook, persistent record, or recovery story to invent.

## Falsification rules

The design fails if it requires:

- changing the existing Timer source;
- serializing a callback, Cordis Context, Fiber, disposer, or Service object;
- Jig awareness of Cordis service keys or plugin lifecycle;
- a Cordis-specific FLOW protocol method;
- exposing scheduler state which the wrapped component does not provide;
- hidden provider restart or rebinding; or
- a dynamic FLOW dependency/export merely because Cordis is dynamic locally.

## Findings

- `await root.plugin(Timer)` already makes `root.timeout()` available. An
  artificial bridge plugin would test our own wrapper rather than Timer reuse.
- Cordis callbacks and their disposer remain realm-local. Only bounded JSON
  crosses FLOW.
- Invocation cancellation calls the disposer immediately. Mount cancellation
  disposes the root Fiber, so Cordis clears any remaining timer effects.
- The Service needs one explicit Binding because Services are activated policy,
  not default Runs. The Python consumer needs one explicit Binding because it
  has a required capability slot. No other Binding is justified.
- A small Service-SDK setup result can own readiness, waiting, cancellation,
  and final disposal. Repeating that lifecycle ceremony in every adapter would
  be framework tax, not application logic.

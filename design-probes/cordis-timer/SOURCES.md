# External component under test

The probe targets:

```text
cordis                         4.0.0-rc.8
@cordisjs/plugin-timer        1.1.2
```

The Timer source is used unchanged through its published package. npm records
commit `6325ce25abb61d8aa112119c949cd52c6f8dcdd6` for release `1.1.2`; its
relevant behavior is visible in that exact upstream
[`packages/timer/src/index.ts`](https://github.com/cordiverse/cordis/blob/6325ce25abb61d8aa112119c949cd52c6f8dcdd6/packages/timer/src/index.ts):

- `TimerService extends Service` and registers as `timer`;
- `ctx.timeout()` and `ctx.interval()` wrap native timers in `ctx.effect()`;
- each callback form returns a realm-local disposer; and
- disposal clears the native timer.

Cordis core is the upstream
[`cordiverse/cordis`](https://github.com/cordiverse/cordis) project. Versions
are native package dependencies, not FLOW contract or runtime-profile values.
The eventual native lock is the dependency-resolution authority.

This experiment was reviewed against upstream source on 2026-08-23. It does
not claim compatibility with every Cordis release or fork.

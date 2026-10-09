# User updates profile

## Purpose and ownership

Owns the portable user-updates Channel Contract, its scoped TypeScript publisher,
semantic validator, tests, and distribution. Jig owns selection, resource policy
and terminal rendering. This library owns no execution authority or new FLOW wire
operation. Python's independently packaged counterpart lives in `../jiggy-user-updates`.

## Local contracts

- `src/user-updates.json` is the canonical self-contained descriptor. Copies in
  distribution artifacts must preserve its exact bytes. Derive identity from
  canonical JSON using existing FLOW rules; never maintain a handwritten digest.
  Root `.gitattributes` retains LF bytes for every `user-updates.json` copy,
  including Windows checkouts used to qualify installed Python artifacts.
- Validate and snapshot before disabled/unwired checks. Notices and clears are
  ordering barriers. A scope exclusively owns its writer and all local tasks.
- Views are whole portable documents, never callbacks or terminal layout. Keep
  TS/Python closed schemas, semantic aggregate limits and JSON/0 numeric/byte
  accounting identical. `view()` claims a local lifetime ID; one landing hint,
  fixed call association, no reuse after retirement. Only consecutive unsent
  same-view/activity tails coalesce; removals and in-flight items are barriers.
- Local publication budgets stop observations, never cancel original sends or
  discard their eventual errors. Close acknowledgement is not send settlement.
  Final drain follows restarted pumps under one body-exit timer before closing
  the writer; an offer during pump teardown cannot escape scope ownership.
- Only genuine observer LAGGED/DISCONNECTED may degrade. Preserve root cancellation
  and body errors; expose unexpected publisher failures.
- All original material here is MPL-2.0, including the descriptor. Keep its license
  with bundled or imported copies. Do not change Jig's own license.


Notice severity is optional info/warning/error (absent means info). Preserve its
exact snapshot and ordinary ordering/limits in both language packages. It is
author-reported importance, not host status or a reliable diagnostic transport.

The public `./validation` entry owns portable semantic validation, message types,
canonical JSON and limits. Keep it free of publisher, FLOW runtime and Node API
imports; `message.ts` owns descriptor-derived contract identity and reexports the
same validator for existing main-entry callers. UTF-8 counting uses `TextEncoder`
and must preserve the profile's byte accounting in both runtimes.

## Verification

`just build`, `bun test`, packed Node consumer, and the matching Python publisher
must establish lifecycle, identity and boundedness separately. Public availability
must state the tested runtimes; approval of a design is not qualification.

The final best-effort drain allows 4000 ms from body exit; individual send wait
remains 500 ms. Drained/unwired scopes add no waiting period. Neither allowance
is a scope-return ceiling or delivery guarantee; preserve the root deadline.

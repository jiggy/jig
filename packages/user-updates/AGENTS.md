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
- Validate and snapshot before disabled/unwired checks. Notices and clears are
  ordering barriers. A scope exclusively owns its writer and all local tasks.
- Local publication budgets stop observations, never cancel original sends or
  discard their eventual errors. Close acknowledgement is not send settlement.
- Only genuine observer LAGGED/DISCONNECTED may degrade. Preserve root cancellation
  and body errors; expose unexpected publisher failures.
- All original material here is MPL-2.0, including the descriptor. Keep its license
  with bundled or imported copies. Do not change Jig's own license.


Notice severity is optional info/warning/error (absent means info). Preserve its
exact snapshot and ordinary ordering/limits in both language packages. It is
author-reported importance, not host status or a reliable diagnostic transport.

## Verification

`just build`, `bun test`, packed Node consumer, and the matching Python publisher
must establish lifecycle, identity and boundedness separately. Public availability
must state the tested runtimes; approval of a design is not qualification.

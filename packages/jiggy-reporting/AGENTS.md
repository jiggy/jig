# Python reporting

Owns the independently packaged `jiggy.reporting` profile helper, semantic
validation, typing and tests. It uses only the public `jiggy.flow` SDK. The
canonical descriptor belongs to `../reporting/src/reporting.json`. This
package's copy must be byte-identical and shipped with MPL-2.0 licensing.

Read-only view handles and closed block/reference validation match TypeScript.
Validate and clone before unwired checks. Keep aggregate limits, safe integral
JSON/0 values and canonical binary64 byte accounting aligned. Lifetime view IDs
never revive.

Landing/call associations and application targets stay fixed. Pending snapshots
coalesce across identifiers inside one epoch. Notices, clears, retirements and
already sending items preserve their boundaries.

The scope owns every send, close and timer.

Scope exit must join original send and close tasks. Never use cancellation of
the original send as a local timeout. Do not suppress unexpected SDK errors. Do
not replace the application's primary exception. Do not confuse close
acknowledgement with send settlement. SDK retained wire requests keep their
existing owner.

Run unittest, build both distribution formats, and test an installed wheel.
Python runtime qualification is independent of TypeScript's.
Source checks and installed distributions use the package's exact declared SDK version.

The final best-effort drain allows 4000 ms from body exit. Individual send wait
remains 500 ms. Drained/unwired scopes add no waiting period. Neither allowance
is a scope-return ceiling or delivery guarantee. Preserve the root deadline.


`view.py` owns literal report formats, explicit collection roles and captured-media references.
Layout blocks and row details keep separate budgets so complete thousand-row collections remain useful.
`preview.py` selects whole rows and discloses omissions without modifying source values.
`bundle.py` owns pure final-edition validation, opaque context binding and canonical encoding.
These helpers perform no file operations or trusted source assignment.

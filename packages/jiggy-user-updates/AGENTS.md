# Python user updates

Owns the independently packaged `jiggy.user_updates` profile helper, semantic
validation, typing and tests. It uses only the public `jiggy.flow` SDK. The
canonical descriptor belongs to `../user-updates/src/user-updates.json`; this
package's copy must be byte-identical and shipped with MPL-2.0 licensing.

Read-only view handles and closed block/reference validation match TypeScript.
Validate and clone before unwired checks; keep aggregate limits, safe integral
JSON/0 values and canonical binary64 byte accounting aligned. Lifetime view IDs
never revive; landing/call associations stay fixed. Only adjacent unsent tails
of the same activity/view coalesce. The scope owns every send, close and timer.

Scope exit must join original send and close tasks. Never use cancellation of
the original send as a local timeout, suppress unexpected SDK errors, replace
the application's primary exception, or confuse close acknowledgement with
send settlement. SDK retained wire requests keep their existing owner.

Run unittest, build both distribution formats, and test an installed wheel.
Python runtime qualification is independent of TypeScript's.

The final best-effort drain allows 4000 ms from body exit; individual send wait
remains 500 ms. Drained/unwired scopes add no waiting period. Neither allowance
is a scope-return ceiling or delivery guarantee; preserve the root deadline.

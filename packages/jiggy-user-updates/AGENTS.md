# Python user updates

Owns the independently packaged `jiggy.user_updates` profile helper, semantic
validation, typing and tests. It uses only the public `jiggy.flow` SDK. The
canonical descriptor belongs to `../user-updates/src/user-updates.json`; this
package's copy must be byte-identical and shipped with MPL-2.0 licensing.

Scope exit must join original send and close tasks. Never use cancellation of
the original send as a local timeout, suppress unexpected SDK errors, replace
the application's primary exception, or confuse close acknowledgement with
send settlement. SDK retained wire requests keep their existing owner.

Run unittest, build both distribution formats, and test an installed wheel.
Python runtime qualification is independent of TypeScript's.

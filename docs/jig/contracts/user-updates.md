# User updates contract

A Flow can report complete notices, replace transient activity and publish
read-only domain views while it
works. This optional agreement lets different callers understand those messages
without adopting the Flow's application policy or Jig's terminal implementation.

The [canonical descriptor](https://jig.md/contracts/user-updates.json) defines
five closed messages: `notice`, `activity`, `clear`, `view` and `retire-view`. Its provisional
identity is `https://jig.md/contracts/user-updates`, version `0.1.0`. Identity,
version and digest are checked offline; this page is never fetched at Run time.
The descriptor is owned by the portable `@jigging/user-updates` library and is
distributed under [MPL-2.0](https://jig.md/contracts/user-updates/LICENSE).
Copy its license with the agreement. This does not change Jig's software license.

Create the `contracts` parent directory, then run
`jig import-contract jig:user-updates contracts/user-updates` from a
Flow package whose `contracts` directory already exists. Add an optional send
port referencing `./contracts/user-updates/user-updates.json`. The local port
name is your choice; a named invocation contract for the entire Flow is unnecessary.
Other hosts can use the identical local descriptor from the library or download.

Use the [scoped publisher](../guide/channels.md) for TypeScript or Python to
validate messages and own optional publication cleanup. Activity replaces a
slot's complete state, including optional counts. Clear and every source ending
remove its transient state. Accepted complete notices retain presenter ownership
through ordinary retirement; output loss still prevents delivery guarantees.
Neither counts, 100%, clear nor EOF establish execution success.

Views compose literal reports, facts, measured progress and typed collections.
Stable record IDs preserve navigation. Scoped references address current records,
actual own calls or verified delivered files; previews use immutable capture.
Whole snapshots replace atomically. EOF freezes views with ended context, and
retired IDs cannot revive. Applications keep essential evidence in results/files.

Jig can display one exact optional port on stderr, using plain text when redirected.
`jig run --display dashboard` supplies tabs, record details, filtering and previews;
`--display plain` selects nonanimated summaries. Explicit `--receive`
retains normal stdout channel records; `--json` and `--updates off` disable
automatic display. See [user-updates policy](../spec/user-updates.md) for exact
selection, bounds, rendering and lifetime rules.

A notice may declare `severity`: `info`, `warning` or `error` (default info).
This is Flow-reported importance, without changing optional delivery or execution
authority. Report blocking problems promptly and retain their reasons in results.

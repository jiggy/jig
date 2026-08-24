# Tabletop failure walkthroughs

These are expected architectural outcomes, not executed tests.

## Runtime unavailable

The host has no installed Adapter mapped to `python3`.

1. The `count-text` package remains discoverable.
2. Planning admits `count-long-words` as structurally valid but operationally
   `UNAVAILABLE(RUNTIME_UNAVAILABLE)`, with exact evidence. It does not block
   an independently ready `compact-summary` Binding and cannot enter a
   Resolver candidate set.
3. Applying the candidate pins that unavailable result. Jig does not execute
   `/usr/bin/env`, search `PATH`, install Python, or use the
   Markdown body as an implementation.
4. An explicit root submission still allocates its idempotent Run, validates
   input, and terminates with the pinned reason before preparation or spawn.
5. Installing Python produces a new candidate requiring review/apply. It never
   heals the old generation; retrying the old submission key returns the old
   terminal Run, while a deliberate retry uses a new key.

The same reasoning applies to a missing `deno` mapping.

## Native runtime constraint is unsatisfied

The selected Python Adapter can prove only Python 3.12, while
`pyproject.toml` requires Python 3.13 or newer.

1. The Adapter reports the native constraint as unsatisfied.
2. Planning records the Binding as
   `ADMITTED + UNAVAILABLE(RUNTIME_UNAVAILABLE)`.
3. FLOW does not reinterpret or duplicate the Python version range.

## Runtime ambiguous

Host policy leaves two eligible trusted Adapters after applying the suffix,
selector token, native metadata, and verified toolchain evidence.

1. Planning records `ADMITTED + UNAVAILABLE(RUNTIME_AMBIGUOUS)` with both
   candidates as evidence.
2. Installation order, previous success, and semantic reasoning do not choose.
3. The project cannot add a runtime profile to resolve host policy.

## Invalid Binding settings

Change `minWordLength` to `0`, remove it, or add an undeclared setting.

1. Binding normalization fails with `INVALID_SETTINGS`.
2. Runtime probing, dependency preparation, and implementation execution never
   begin.
3. An environment variable cannot supply or repair the value.

## Invalid Run input

Submit valid JSON/1 whose `text` is missing or has the wrong type.

1. Root admission allocates one idempotent Run.
2. Schema validation makes that Run terminal `INVALID_INPUT`.
3. The exact implementation never starts.

Malformed or out-of-bounds JSON/1 is rejected before Run allocation because it
is not a valid host-operation value.

## Sandbox unavailable

Runtime inspection succeeds, but no installed Backend can realize the required
containment predicates.

1. Planning records the otherwise valid Binding as
   `ADMITTED + UNAVAILABLE(SANDBOX_UNAVAILABLE)`.
2. Jig does not launch the implementation directly.
3. V1 has no trusted-package mode, and the project cannot select a weaker
   Backend.

If a pinned Backend later fails to realize or attest the planned predicates at
seal/spawn, the already ready Run fails `PERMISSION_UNENFORCEABLE` against its
pin. It does not select a different Backend or instruction implementation.

## Pinned machinery disappears

The Binding was admitted `READY`, then its exact toolchain or Backend vanishes
or changes before the Run prepares or spawns.

1. `READY` remains evidence that its recipe was realizable at admission, not a
   promise that host machinery stays live.
2. The Run verifies its exact pinned artifact and fingerprint and fails visibly
   when they no longer match.
3. It does not probe alternatives or switch to Markdown. A later plan/apply may
   admit another recipe or an unavailable state; the old Run remains pinned.

## Unapproved package or Binding edit

Change a Flow byte, add a package, or edit a Binding after the current
generation was admitted.

1. The change creates a new inert candidate and package or Binding identity.
2. Existing Runs retain their prior immutable generation.
3. No new or changed authority becomes active until aggregate review and
   compare-and-set apply.

## Lost root-start acknowledgement

The frontend submits a root request, Jig allocates its Run, and the
acknowledgement is lost.

1. The frontend retries the same project-local submission key and content.
2. Jig returns the existing Run without re-resolving later policy.
3. Reusing the key with different input yields `SUBMISSION_CONFLICT` and no
   second Run.

## No instruction fallback

An Adapter, native constraint, preparation, launch, protocol exchange, or
result fails.

1. Failure remains visible at its original seam.
2. Jig never sends `FLOW.md` to an Agent: neither package declares
   `fallback: instruction`, neither Binding opts into it, and this project has
   no Agent Binding.

## Root cancellation

The user requests cancellation of a running `count-long-words` Run by its
durable Run identity through the host-local Run-control operation. Its public
API spelling remains open.

1. Jig records cancellation and closes new admission only for that Run's owned
   subtree.
2. If the FLOW/1 request remains live, Jig sends the exact notification-only
   `request/cancel` for that request. Duplicate notifications are idempotent.
3. Descendants and host-owned resources close child-first within a fixed grace
   period. A normal terminal response may still win if it committed first.
4. If the dedicated process tree does not quiesce, the Backend terminates and
   fences it. Cancellation never waits forever and does not imply rollback of
   an already dispatched external effect.

## Component crash or protocol EOF

The exact implementation exits or closes stdout before a complete terminal
response.

1. An owner still in `OPEN` becomes lost; Jig does not infer a domain outcome,
   replay the Run, select another Adapter, or invoke instruction fallback.
2. Every pending owned child operation is made terminal or explicitly
   uncertain, then bounded cleanup runs.
3. If EOF follows a complete buffered terminal response, it closes remaining
   wire requests but does not overwrite that response; success still requires
   owner quiescence and result-schema validation.

## Coordinator crash and stale sandbox

Jig crashes after committing spawn intent or while a Run is live.

1. Confinement must outlive the protocol channel, and the sandbox is
   enumerable by a durable single-use container identity rather than a bare
   PID.
2. A new coordinator epoch keeps admission closed while reconciling every old
   spawn intent and container.
3. Stale trees are killed or quarantined, dispatched effects are recorded
   honestly as terminal or uncertain, and conflicting write leases remain
   closed until cleanup is proven.
4. An unknown container blocks recovery; Jig never assumes it disappeared.

## Revocation race

The operator revokes `count-long-words` while a root request is being admitted
or executed.

1. The revocation transaction writes its tombstone, advances the active
   generation, and closes admission before cancellation/fencing begins.
2. An absent-key root request that has not committed cannot cross the closed
   gate. A Run already allocated by the winning admission transaction retains
   its pinned generation and is cancelled or fenced; committed external work
   remains terminal or uncertain rather than rolled back.
3. The same submission key always returns its recorded result and cannot use a
   later restored Binding. Restoring authority requires a fresh aggregate apply
   and a new key for deliberate new work.

## Uncooperative cleanup

The component returns or is cancelled but leaves owned work or processes live.

1. Jig closes new child admission, resolves pending owned operations, and
   performs child-first cleanup for a bounded interval.
2. Outstanding owned work prevents success even if a syntactically valid
   `done` result was received.
3. At the hard deadline the Backend terminates/fences the complete target tree.
   Cleanup failure makes the owner failed or lost; it is never reported as a
   successful domain outcome.
4. Leases and conflicting admission stay closed until cleanup or fencing is
   proven.

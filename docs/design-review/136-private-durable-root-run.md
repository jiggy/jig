# Private durable root Run

**Status:** historical implemented checkpoint, corrected by
[review 142](142-direct-root-closure-repair.md). One exact admitted Python Run
first crossed the durable boundary here, but this checkpoint did not yet prove
recoverable backing ownership, fence-before-release, result admission, or the
final terminal-close ambiguity. Review 142 is authoritative for those claims.
The implementation remains private.

## 1. Minimal durable state

Private schema version 5 added only three relations:

```text
root_runs
    immutable submission identity + pinned admission/candidate + request

root_spawn_intents
    immutable pre-spawn execution identity for READY targets

root_terminals
    exactly one canonical terminal
```

Keeping these records beside admission makes selection and Run allocation one
SQLite transaction. A second database would require a cross-database commit or
permit a Run to name a generation it never atomically pinned.

The submission key is opaque and project-local. Its immutable content identity
covers only canonical `(target, input)`, matching project policy; a host-chosen
deadline is stored on the first Run but is not caller work identity. Repeating
the same key and content returns the original Run without consulting newer
policy or granting launch authority. Changed target or input fails with
`SUBMISSION_CONFLICT`.

Invalid JSON/1 is rejected before allocation. A valid JSON/1 value that fails
the admitted package's `input.schema.json`, an unknown target, or an admitted
unavailable disposition allocates one terminal non-spawning Run. Input schema
validation uses the freshly reacquired protected Package/1 inspection.

## 2. At-most-one dispatch boundary

Only the transaction which inserts a READY spawn intent receives an opaque,
invocation-local launch object. Replays receive the durable Run only. The
controller consumes that object once, re-plans from the stored activation
request plus current authenticated runtime/backend observations, and requires
the recipe and observation identities to reproduce the admission exactly.

The controller then executes the existing Package/1 -> cgroup-v2 -> Bubblewrap
-> Run/1 path. The later corrected controller publishes a terminal only after
durable preparation, a confirmed process-tree fence, backing release, and
result admission. Planning or execution failure becomes `EXECUTION_FAILED`
only after the same fence/release boundary; missing machinery never selects
another recipe.

This gives one live coordinator at-most-one dispatch for the supported path.
It does not pretend that SQLite alone fences two simultaneous coordinators.
Review 137 adds the enforceable private project-coordinator lease and epoch
fence without changing this Run record model.

## 3. Restart rule

An exclusive replacement coordinator enumerates spawn intents without
terminals. The Root Administration controller then recovers each exact owner,
confirms fencing, releases backing, and only then may publish:

```text
lost / COORDINATOR_LOST
```

It never replays package code, retargets to a newer generation, or infers
success whose terminal bytes were not durably committed. Existing cgroup
hostile tests separately prove that the privileged helper fences and cleans an
active descendant tree after coordinator `SIGKILL`; the retained-project proof
now also creates a spawn intent in a fresh coordinator process, kills that
coordinator, and reconciles the Run to `COORDINATOR_LOST`.

## 4. Proof

- The ordinary admission-store suite proves canonical allocation, terminal
  schema failure, idempotent replay, changed-content conflict, withheld replay
  launch authority, durable terminal reopening, and idempotent lost-state
  reconciliation.
- The proof-host retained-project case admits a real Package/1 Python Flow,
  submits it durably, executes it through the cgroup-v2/Bubblewrap controller,
  replays its successful terminal, and reconciles a killed coordinator's
  second spawn intent to `COORDINATOR_LOST`.
- The Backend's existing hostile corpus continues to own resource ceilings,
  cancellation, whole-tree quiescence, and zero-residue claims.

## 5. Deliberate boundary

This checkpoint does not add a public `startRun`, queue, retry policy, child
Flow dispatch, effects, Hooks, Services, or semantic choice. It also does not
publish a generic execution extension interface after proving only one Python
Adapter and one Linux Backend. Review 137 satisfies private coordinator
ownership; the next release gate is an independent consumer of the smallest
administration surface, not more execution features.

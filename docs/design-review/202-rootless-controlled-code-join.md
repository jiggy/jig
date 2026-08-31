# Rootless controlled-code join

**Status:** completed on 2026-08-31 for the direct-alpha controlled-code
boundary.

## Result

Every currently retained alpha execution stage now uses the canonical
rootless backend before project-controlled bytes can execute:

```text
captured project declaration
    -> bounded author evaluator in rootless envelope
    -> exact retained dependency classification
    -> optional networkless, script-disabled preparation in rootless envelope
    -> immutable prepared package
    -> admitted Run/1 process in rootless envelope
```

The evaluator, preparation worker, Bun and Python direct recipes, root owner,
child-call owner, and retained Service evidence all consume the same private
backend contract. None can select a backend, Bubblewrap arguments, cgroup,
runtime support, or host-control executable from package input.

## Preparation rule at this checkpoint

Preparation remains the single narrow pre-existing Bun case. The retained
package must either have no external dependency or contain the exact admitted
package-local FLOW SDK archive accepted by the classifier. Preparation has no
network, ignores lifecycle scripts, receives only immutable package/runtime
bytes and private scratch, and publishes a sealed tree only after a confirmed
fence. Every other dependency shape is unavailable before Flow execution.

This is not a general package manager, runtime registry, or broader dependency
promise. Goal G9 still decides whether this narrow path belongs in the alpha's
final user-facing dependency rule.

## Evidence

- The deterministic native-preparation corpus passes 11 tests and 83
  expectations.
- The real hostile join passes one 24-expectation campaign covering a genuine
  package-local SDK archive, script-bearing archive refusal, bounded output,
  durable preparation ownership, project evaluation, admitted execution, and
  zero cgroup/rootless-temp residue.
- The evaluator needed 64 rather than 32 cgroup PIDs because `pids.max` counts
  Bun runtime threads. The limit remains finite and enforced; the diagnostic
  now distinguishes process-limit and memory-limit failures without exposing
  host paths or controls.

## Exclusions

This checkpoint does not create an installed runtime source, public Backend or
Runtime Adapter interface, additional package dependencies, network access,
lifecycle scripts, ambient `PATH` discovery, or another operating system.

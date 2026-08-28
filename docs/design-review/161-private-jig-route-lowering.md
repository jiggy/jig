# Private Jig route lowering over Sley

**Status:** closed as a negative checkpoint on 2026-08-28. Direct lowering was
proved feasible and then removed because it did not clear its value-over-direct
Sley gate. This review defines no public Jig Graph SDK, general graph DSL, or
Jig dependency on Sley.

## 1. Why this is the next smallest proof

The current architecture assigns semantic route meaning to Jig Graph and live
graph advancement to Sley. The existing Run/1 component proves only that an
ordinary component may use Sley behind FLOW. It does not prove that a detached
Jig-owned route definition can be validated, lowered, and correlated with the
compiled Sley topology.

The first proof therefore accepts exactly one serializable routing shape:

```text
one workflow
    -> one semantic router node
        -> two to 256 named paths
            -> compiler-owned terminal target nodes
```

The definition contains stable workflow, router-node, path, and target-node
IDs; an objective; a context Schema/1 value; and one input Schema/1 value per
path. It contains no Sley objects, callbacks, numeric IDs, run state, effects,
Agents, or provider references.

This deliberately narrow form is enough to test ownership of IDs, contracts,
schemas, selection, lowering, and static correlation. General handlers,
nested Flows, cycles, fan-out, joins, retries, recovery, effect operation IDs,
and FLOW outcome projection require real consumers before they earn an API.

## 2. Experiment boundary

The private experiment was required to:

1. detach and deeply freeze ordinary JSON/1 source before Sley construction;
2. reject extra fields, invalid or duplicate IDs, invalid route counts,
   missing target identity, and malformed Schema/1 values;
3. compile the context and every path-input schema using Jig's Schema/1
   implementation;
4. create fresh ordinary `node` and `Flow` objects through only the public
   `@jigging/sley` API;
5. assign compiler-only unique diagnostic names and one generated nonsemantic
   Sley action per Jig path;
6. call `compile()` and validate the detached `describe()` result against the
   source topology;
7. retain a compilation-local mapping from Sley element IDs to stable Jig
   workflow/node IDs; and
8. return the compiled Sley Flow and static compilation receipt without
   exporting either from `@jigging/jig`.

Sley numeric element and scope IDs are ephemeral evidence for one compiled
snapshot. They never enter a Jig definition, portable lock, durable workflow
identity, or cross-compilation trace.

The compiled router calls the already proven synchronous private Semantic
Choice boundary. Candidate IDs are the exact Jig path IDs and the chooser sees
their source order. It can only select or abstain. It cannot create route
input: the compiler validates and forwards the existing payload unchanged.
Unknown or malformed decisions fail before `context.emit`.

Abstention is an explicit graph failure in this checkpoint. It never selects
a default path. Invalid context fails before chooser work. Invalid selected
path input fails before target activation or graph control.

## 3. Honest correlation and observation

`compile().describe()` is static topology, not an execution trace. The private
compilation receipt may map a structured Sley failure's `elementId` back to a
stable Jig workflow/node ID for that exact compiled artifact. It must not
claim terminal activation IDs identify nodes or that settlement order is an
execution history.

Compiler-owned handlers may append bounded immutable facts containing only
stable Jig IDs for this proof. Such facts describe Jig-owned handler
observations, not every Sley transition and not durable telemetry. A buffered
`emit` request is not described as committed graph control.

## 4. Package and compatibility boundary

The experiment temporarily pinned exact `@jigging/sley` 0.0.2 as a development
dependency because its private module was not reachable through package
exports. It used the actually installed 0.0.2 declarations, whose compiled
description collections require runtime parsing, rather than assuming richer
future declaration types. The dependency and module were removed with the
failed candidate; Sley remains neither a Jig microkernel dependency nor a
portable FLOW requirement.

A future public Jig Graph package/subpath and its dependency policy remain
unselected. Publishing one requires a second real graph use case and an
independently authored consumer.

## 5. Experiment and disposition

One unexported candidate implemented the frozen boundary against exact
`@jigging/sley` 0.0.2. Nineteen focused Jig-route and Semantic Choice tests
passed with 94 assertions, and the Jig TypeScript build passed. The experiment
proved:

- a JSON-round-tripped Jig-owned route definition could be detached, frozen,
  schema-validated, and lowered through only public Sley APIs;
- the existing closed Semantic Choice boundary could select exact paths while
  malformed, unknown, and abstained decisions reached no target;
- generated diagnostic names could correlate Sley handler failures with Jig
  IDs for one compiled snapshot; and
- repeated executions of one compiled snapshot retained Sley invocation
  isolation.

The candidate nevertheless required 478 implementation lines and 343 test
lines to wrap behavior an ordinary direct Sley router expresses in roughly 45
lines. Its only targets were compiler-invented terminal echo nodes. No project
artifact, lock, admission record, authoring surface, or real workflow consumed
the serialized definition or compilation receipt. Its partial parser also
duplicated only some of Sley's `describe()` validation while leaving scope and
entry facts unchecked.

That fails this review's stop condition. The implementation, tests, temporary
Sley development dependency, and generated lock were removed. Keeping them
would have promoted a speculative graph grammar merely because its own probe
needed one—the exact failure mode the independent-probe methodology forbids.

## 6. Stop conditions

Do not retry this proof by adding:

- a public export, package name, or machine schema for this private candidate;
- arbitrary user handlers, a handler registry, or code references in JSON;
- async/Agent-backed decisions or candidate-universe integration;
- Sley subclasses, metadata attachment, internal imports, or scheduler forks;
- retries, cycles, fan-out, joins, nested Flows, effects, permissions,
  persistence, or FLOW adapters; or
- a universal trace or automatic Sley-terminal-to-FLOW-outcome mapping.

Resume only when one real Jig-owned graph definition must be stored or
validated independently of executable code and contains at least one
meaningful non-router operation or nested composition that a direct Sley
factory obscures. Freeze that consumer's smallest model first and give it to
an independent implementer. Until then, direct component-owned Sley code is
the correct implementation and the architecture retains only this rule:

> Jig owns semantic route meaning; Sley owns live graph advancement. A future
> compiler may lower the former to ordinary Sley objects without making Sley
> the metadata authority.

# Jig application behavior explorer

Can existing Jig and FLOW source support useful workflow diagrams without another authored workflow definition?

**Yes for configured composition and declared runtime topology.** These experiments generate both views and preserve their different meanings.
They do not recover every feasible execution path through arbitrary code.

This directory contains research tools, not supported Jig commands or a new FLOW interface.
The prototype does not change admission, execution, the Run protocol, or the existing web display.

## Understanding application behavior

The explorer helps users inspect application behavior and describe changes to their coding agents.
It keeps the codebase as the workflow definition.
Visual editing and agent execution remain outside this experiment.

The interface starts with an application overview.
The diagram gives stable spatial context while users inspect components and recorded cases.
Technical provenance stays available through disclosure instead of occupying the main workspace.
Selecting a component opens its description, available relationships, and relevant observations.
Different Bindings remain separate even when they use the same package.

Recorded cases add concrete input and terminal output.
Repeated handler entries remain separate visits.
Each captured visit can show evaluated conditions, operand values, emitted actions, and before-and-after state.
The comparison view identifies changed inputs, changed outputs, and differences in recorded decision evidence or handler entries.
It does not claim that an input difference caused a behavioral difference.

The copy action produces bounded investigation context for the user's coding agent.
It includes the selected component identity, source reference, case evidence, and relevant limits.
It sends no message and starts no agent.

Source-only examples retain useful composition views without inventing execution evidence.
They show when conditions or case observations are unavailable.
The prototype contains no execution controls.
Inspecting captured state for a component is not an independent component test.
New test inputs require a separately authorized execution path and real observations.

## What the experiment establishes

Three evidence sources answer different questions.

| Source | What it establishes | What remains unknown |
| --- | --- | --- |
| Public `jig.lock` | Resolved component identities and effective slot selections | Local approval, call order, conditions, repetition, and actual use |
| Literal project source | Authored memberships, explicit selections, and recognized default selections | Full TypeScript behavior, exact eligibility, dependency contents, and admission |
| Sley `compile().describe()` | Declared elements, links, scope entries, scope exits, and limits | Callback behavior, every emitted action, feasible paths, and FLOW slot correspondence |

The source probe generated entrypoint graphs for all six current examples without evaluating their modules.
The Sley probe extracted a revision cycle without executing any handler during inspection.
Five actual local Sley runs then exercised different behavior over the same compiled description.

## Reproduce the explorer

Source and lock projection use Node built-ins and have no third-party dependencies.
Run these commands from the Jig repository root with Node 22 or newer.

```sh
node --test scripts/experiments/visual-flows/*.test.mjs

node scripts/experiments/visual-flows/explore.mjs \
  --examples examples \
  --sley scripts/experiments/visual-flows/sley-example.json \
  --output .tmp/visual-flows.html
```

Open the generated file in a browser.
The review pipeline opens first when its recorded evidence is included.
Choose **Recorded cases** and compare **Accepted after revision** with **Attempts exhausted**.
Inspect the second **Check** visit to see the evaluated conditions.
Then inspect **Accepted at the limit** to see acceptance take precedence.
Switch to a Jig example to inspect its configured composition.

The viewer exports its current graph as JSON.
It contains no network dependencies or requests.

Output paths must be new files.
Choose another path when regenerating an explorer.
The optional `--revision` argument records a complete source commit supplied by the caller.
It does not verify a checkout against that commit.

### Inspect an existing lock

```sh
node scripts/experiments/visual-flows/explore.mjs \
  --lock /path/to/project/jig.lock \
  --root binding:main \
  --output .tmp/configured-flows.html
```

Omit `--root` to inspect the captured inventory.
Use `--format json` to export the projected data.
This operation reads inert JSON and executes no project code.
It does not call `jig review` or change local approval.

`jig.lock` records desired state.
Possessing that file does not establish consent or readiness on the current host.
The projection validates graph structure and selected references, not the complete Jig lock contract.

### Inspect literal source

```sh
node scripts/experiments/visual-flows/explore.mjs \
  --project examples/software-factory \
  --root binding:factory \
  --output .tmp/factory-composition.html
```

The source reader recognizes literal `defineJig`, `defineBinding`, and `discover` declarations.
Discovery follows the documented shallow membership rule.
The reader never imports the declaration modules.
Source scanning assumes a stable project tree.
It does not provide isolation against concurrent filesystem changes.
Computed expressions, additional statements, unsupported declarations, and missing source remain explicit errors or unknown nodes.

Default selections match the declared contract ID against the authored `defaultProviders` map.
They carry a diagnostic because this match does not validate exact interfaces, required features, dependency preparation, or eligibility.
External npm implementations remain opaque.
The source reader supports code metadata only and leaves Markdown metadata unresolved.

It retains authored descriptions up to 4096 UTF-8 bytes, with their package-metadata provenance.
Malformed or oversized descriptions are omitted with `INVALID_PACKAGE_DESCRIPTION`, while route analysis continues.
Descriptions explain authored intent and do not prove behavior.

This parser tests the usefulness of source-derived diagrams.
Production integration should project the existing resolved or admitted graph instead of maintaining another project evaluator.

## Results on existing examples

The source experiment used Jig commit `5c02109a27e588011913c09e70d613923742b2f3`.
It selected each example's authored entrypoint without changing its source.

| Example | Nodes | Connections | Unresolved target nodes |
| --- | ---: | ---: | ---: |
| Contact import | 5 | 4 | 0 |
| Kitchen roster | 7 | 6 | 0 |
| Photo organiser | 7 | 6 | 0 |
| Software factory | 11 | 12 | 1 |
| Support case | 5 | 4 | 0 |
| Tested patch | 9 | 8 | 0 |
| Total across these views | 44 | 40 | 1 |

Nodes include configured Bindings and resource boundaries.
These counts do not measure distinct packages, branch coverage, feasible paths, or workflow completeness.
Zero unresolved targets does not make an opaque implementation inspectable.

The software factory preserves two configurations of `flows/repair`: `single-pass` and `checked-correction`.
Combining them into one package node would lose meaningful configuration differences.
Its checkpoint requirement remains unresolved because this source probe does not infer implicit qualified host support.
Five default-selection edges across the examples remain explicitly unverified.

The support case illustrates another distinction.
Its configured graph shows that the coordinator can call assessment and credit checking.
The source method decides that a blocked assessment returns before credit checking.
Slot declarations alone cannot supply that conditional sequence.
See [the actual coordinator](../../../examples/support-case/flows/resolve/resolve.ts).

## Runtime-owned topology

Sley already provides a public compiled-description API and a visualization cookbook.
The probe uses that API directly instead of reconstructing its scheduler.

The recorded experiment used unchanged Sley 0.0.3 source at commit `dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a`.
Node 24.22.1 stripped the source types and loaded the ordinary public ESM export.
The reproduction tool verifies the original Git blob identities before building.
This qualifies those source bytes, not a published npm artifact or installed Jig host.

```sh
git clone https://github.com/jiggy/sley .tmp/sley-source
git -C .tmp/sley-source checkout dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a

node scripts/experiments/visual-flows/sley-source-probe.mjs \
  .tmp/sley-source .tmp/sley-proof
```

The output directory must not exist.
Use Node 24 or newer for this source reproduction.
The resulting `evidence/sley-example.json` can replace the recorded dataset through the explorer's `--sley` argument.

The separate `sley-probe.mjs` imports `@jigging/sley` normally.
Consumers with that dependency available can run it directly with an output directory argument.
Neither probe invokes Jig, a provider, or another Flow.

### Observed results

| Check | Result |
| --- | --- |
| Compiled elements | 7 |
| Scopes | 2 |
| Declared links | 6 |
| Scope entry links | 2 |
| Handler executions during inspection | 0 |
| Declared revision cycle | Check to Draft, action `revise` |
| Nested scope exits | `accepted`, `exhausted` |
| Description after five different runs | Unchanged |
| Recorded handler entries across the five runs | 24 |
| Recorded condition evaluations | 16 |
| Mutation of a detached description | Did not change the executable graph |

| Executed scenario | Actual handler entries | Terminal output |
| --- | --- | --- |
| Accepted after revision | Choose, Draft, Check, Draft, Check, Publish result | `done` |
| Attempts exhausted | Choose, Draft, Check, Draft, Check, Request review | `needs-review` |
| Rejected before drafting | Choose, Request review | `needs-review` |
| Accepted on first attempt | Choose, Draft, Check, Publish result | `done` |
| Accepted at the limit | Choose, Draft, Check, Draft, Check, Publish result | `done` |

“Publish result” is a local handler that returns a value.
It performs no external publication.
The five scenarios demonstrate this authored probe, not exhaustive input coverage.

Each probe handler records its own entry.
It captures detached before-and-after state, actual condition evaluations, and emitted actions or terminal requests.
The original input remains unchanged after execution.
Occurrence identities belong to the probe and do not impersonate runtime activation identities.
The viewer highlights those actual entries and their counts.
It does not infer edge traversals from adjacent observations.

The equality case sets `acceptAfter` and `limit` to two.
On the second attempt, acceptance succeeds before the limit condition is evaluated.
The record contains no fabricated false result for that unevaluated condition.
This exposes decision priority through actual evidence rather than an inferred branch diagram.
Sley currently exposes no public transition-event stream.

### A limitation exposed by the successful probe

Sley describes the `Check` to `Draft` revision link and the enclosing scope's `accepted` and `exhausted` exits.
It does not identify every callback that can emit those exits.
The viewer therefore keeps the exit vocabulary on the scope and draws no guessed callback-to-exit edges.

Declared graph topology and exhaustive callback behavior remain different claims, even inside a graph runtime.
Sley actions also do not automatically become FLOW outcomes or invocation slots.
Connecting those identities would require explicit, optional evidence from the author or runtime.

Inspection does not make arbitrary module imports inert.
An author-controlled build can export bounded topology data for later display.
Jig should not import third-party workflow code merely to draw a diagram.

## How a Jig integration could work

The first native integration step needs no FLOW protocol change.
Jig already resolves effective routes and validates its component graph.
Its display model already records caller identities, child identities, slots, and individual call identities.

The current native display does not carry this experiment's configured graph, condition evaluations, or per-component state snapshots.
Those require explicit bounded projections and matching evidence owners.
The standalone explorer tests the investigation experience before that integration.

An existing projection owner could expose a bounded graph from the exact admitted generation.
The current display could join observed calls to that graph through the known root identity and caller-local slot.
Repeated calls would retain distinct invocation identities while highlighting the same configured relationship.

Keep these evidence layers separate:

1. Configured relationships describe available calls.
2. Declared runtime topology describes optional internal structure.
3. Recorded observations describe one run within its retained scope.

An unobserved relationship does not mean “skipped” or “impossible.”
A returned call does not establish domain success.
Observation timestamps do not establish measured execution duration.
Source revisions and graph identities must match before overlaying execution history.

Historical playback needs a separate evidence decision.
Current saved packets and retained views do not preserve complete invocation histories.
The prototype adds no archive or retention behavior.

Internal topology should remain an optional runtime-owned artifact.
The experiment does not select a universal graph language, standard sidecar, plugin system, or privileged runtime integration.
It preserves the current division between FLOW boundaries, Jig authority, and runtime-owned internal control.

## Why this differs from exhaustive path recovery

n8n starts from authored node connections.
Its Code node can still contain arbitrary JavaScript or Python.
Our inference is that useful visual clarity does not require expanding every internal computation into the canvas.

Exact feasible-path recovery for arbitrary programs is not generally computable.
Conservative analyses can include impossible paths, while incomplete analyses can miss real paths.
Loops can still appear as finite cycles in a useful diagram.
The limitation concerns exact behavior, not whether a diagram can be drawn.

The current prototype analyzes declarations, not TypeScript method bodies.
It does not claim to recover helper calls, concurrency, exception handling, cancellation, dynamic imports, or Agent decisions.
It never labels a limited scan as workflow coverage.

The product direction is visibility over code-owned workflows.
It does not require bidirectional canvas editing or generated workflow definitions.

## Verification and limits

The focused tests exercise inert parsing, projection semantics, malformed input, cycles, scope selection, redaction, output refusal, and renderer data embedding.
They also check case comparisons, repeated component identities, retained observation selection, and missing values.
They use Node built-ins, ordinary data, and temporary files.
The optional Sley probe executes the real pinned runtime.
No mocks substitute for Jig admission, storage, providers, execution, or cleanup.

This environment lacked Bun, Just, and a Chromium executable.
The complete Jig preflight, public documentation checker, and browser layout checks could not run locally.
The available cloud browser also refused local preview URLs under its URL security policy.
Generated JavaScript syntax and data embedding were checked separately.
These checks do not establish browser interaction or production display integration.

The graph extractors bound their input and output and report overflow explicitly.
They omit settings, resource policy payloads, attachment source paths, and entrypoint arguments.
They still expose selected component identities and topology, which can be private project information.

## Source owners

- [Jig lock schema](../../../docs/jig/spec/machine/jig-lock-1.schema.json)
- [Project policy](../../../docs/jig/spec/project-policy.md)
- [Project authoring SDK](../../../docs/jig/spec/project-sdk.md)
- [Resolved slot graph](../../../packages/jig/src/project/slot-graph.ts)
- [Display call model](../../../packages/display-model/src/types.ts)
- [Web display contract](../../../docs/jig/spec/web-display.md)
- [FLOW package dependencies](https://github.com/jiggy/flow/blob/f59cffee241abb6ed8df5a527219f357ed0570b0/docs/flow/spec/package-format.md)
- [FLOW invocation outcomes](https://github.com/jiggy/flow/blob/f59cffee241abb6ed8df5a527219f357ed0570b0/docs/flow/spec/invocation-contracts.md)
- [Sley inspection API](https://github.com/jiggy/sley/blob/dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a/skills/sley/guides/inspection.md)
- [Sley visualization cookbook](https://github.com/jiggy/sley/blob/dc3600ae6c0c0bcab9ceb11b761026f8b1b28c4a/cookbook/python-visualization/visualize.py)
- [n8n connections](https://docs.n8n.io/workflows/components/connections/)
- [n8n Code node](https://docs.n8n.io/code/code-node/)
- [Patrick Cousot on sound approximations and exact analysis limits](https://www.di.ens.fr/~cousot/AI/IntroAbsInt.html)

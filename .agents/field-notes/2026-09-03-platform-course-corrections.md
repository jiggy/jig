# Platform course corrections through the first agentic alpha

- **Status:** Historical, non-normative field note
- **Recorder:** Primary Codex maintainer session; no durable session identifier
  was recorded
- **Evidence window:** Repository history through `b528e2a`
- **Scope:** Causal lessons from the exploratory platform work, direct-Run alpha,
and first Agent integrations

Current product intent lives in [`../product-compass.md`](../product-compass.md),
current engineering guidance in
[`../maintainer-reentry.md`](../maintainer-reentry.md), and exact recovery
landmarks in [`../suspended-experiments.md`](../suspended-experiments.md).

## Why this note exists

The first long maintainer handoff mixed stable engineering law, current release
state, personal observations, and historical causality in one required document.
The living material was later routed to narrower owners. These observations are
kept separately because the sequence of mistakes is useful evidence, while
presenting it as current architecture would be misleading.

## Observed course corrections

### A probe cannot define the interface it is evaluating

The first `design-probes` cycle let experiments alter the platform while trying
to consume it. It even attempted to use a public SDK before that SDK had a
specified interface. Passing results from that loop did not provide independent
API evidence.

The corrective method was to freeze or publish the candidate first, give an
independent builder only public artifacts and documentation, forbid platform
changes during the exercise, and accept failure as useful evidence.

### A component runtime is not Jig's scheduler

The proposal around Caskada helped its successor, Sley, clarify a useful
boundary: Sley advances one live in-process graph; FLOW carries portable
component meaning; Jig owns admission and host authority. A later private Jig
Graph lowering added hundreds of lines around a small direct Sley graph without
an independent stored-graph consumer. It was removed.

The evidence did not say graphs were unimportant. It said a Jig graph language
had not earned its existence.

### A proof-host fact became an architectural detour

The proof machine supplied Bun, Bash, and Python under `/nix/store`. Work then
expanded from verifying exact immutable support into Nix retention, garbage
collection roots, host generations, and daemon-global observations. The valid
requirement was a host-owned lifetime promise that Jig could authenticate. Nix
lifecycle ownership was not a Jig concept.

The experiment branch remains a lab notebook, not deferred product code. A
future Nix project-environment integration would need its own application
outcome and must not be reconstructed from that detour.

### Development containment almost became product vocabulary

A privileged cgroup proof established strong aggregate resource, fencing, and
cleanup invariants. Its host authority and development-sandbox mechanisms did
not belong in the product. The supported path was later replaced by one
rootless mechanism; the privileged path was deleted rather than retained as a
fallback.

The transferable result was the observable containment contract, not the name
or machinery of the environment that made the proof possible.

### Horizontal evidence arrived before an operable product

Journal, Hooks, Services, Agent projection, Semantic Choice, and extensive
durability work existed before an installed user could complete a simple
`jig run`. Those experiments contained real lessons, but their coupled tables,
exports, tests, and concepts slowed the direct release path. More than one
future subsystem had to be deleted from the active product and retained only by
recovery landmarks.

The lesson was not “delete deferred code.” It was “delete coupled code that
makes the selected outcome harder to finish.” Isolated, mature work need not be
destroyed merely because it arrived early.

### Mandatory bundling transferred host convenience to Flow authors

Requiring every dependency to be bundled or copied into each Flow package was
safe but unnatural for ordinary TypeScript development. The replacement used a
narrow, contained, script-disabled materialization of an exact lock, followed
by networkless execution of retained bytes.

This remains a deliberately narrow compromise, not permission to grow a
general package-manager abstraction one source type at a time.

### Embedding Bun solved execution and complicated distribution

A compiled Jig executable proved that runtime support could be carried as one
artifact, but it also carried JavaScriptCore/WebKit redistribution and relinking
questions. The release path moved to an exact external Oven runtime package.
Runtime convenience alone was insufficient evidence for the distribution
choice.

### A development gateway briefly became the provider model

OpenRouter credentials and inexpensive test models were initially reflected in
provider names and defaults. That reversed the ownership: the OpenAI Responses
or Chat Completions wire API is the compatibility contract; a gateway is one
operator-selected endpoint. The provider path was replaced with protocol-named
endpoint, key, and model configuration, while native clients stayed thin over
their actual protocols and shared ACP lifecycle.

The durable lesson is to model the protocol being consumed, never the service
that happened to supply a development credential.

### SDK naming and stdout behavior exposed the process reality

The first TypeScript SDK entrypoint was named `serve()`, which suggested a
resident server even though one process handles one Run and exits. It became
`handle()`. Separately, normal `console.log()` output corrupted the Run/1
protocol because stdout is its framing channel. Capturing the protocol writer
and redirecting the current global console to stderr after `handle()` begins
fixed ordinary handler-time logging.

This did not make arbitrary stdout safe. Top-level import logging, cached
console methods, raw descriptor writes, and inherited child stdout remained
separate cases requiring explicit treatment or rejection.

### Historical reviews became a competing architecture

Hundreds of chronological design reviews forced maintainers to reconcile old
proposals with current behavior. Current public truth was consolidated and the
review tree removed. Git and a small suspended-experiment index retained exact
recovery evidence.

The later correction is equally important: aggressive consolidation must not
discard first-hand causal knowledge merely because it is not current policy.
That is the narrow purpose of this field-note archive.

### Completing one phase did not select the next

After a containment roadmap closed, implementation briefly began on the next
composition frontier without an explicit product decision. The premature code
and frontier document were removed. Completion provides evidence and a report;
it does not silently authorize a new subsystem.

## A dated probe observation

One disposable underpayment-reconstruction design probe combined a real
skill-limited Agent call, source-linked structured extraction, deterministic
integer time and money arithmetic, an expected discrepancy, and an unresolved
ambiguous shift without requiring a new Jig API.

That exercise did not establish legal accuracy, OCR quality, privacy or
provider suitability, professional time savings, extraction precision or
recall, or cross-party value. The probe artifact was intentionally disposable;
only this bounded observation is retained.

## Cross-cutting lesson

The recurring failure mode was not lack of technical rigor. It was allowing a
successful local mechanism to claim a broader architectural role than its
evidence supported. The most reliable recovery pattern was:

```text
name one useful outcome
    -> prove the smallest missing seam
    -> keep authority deterministic
    -> test failure and cleanup
    -> delete the superseded mechanism
    -> return to an independent consumer
```

Use the living guides for current decisions. Return to this note only when the
causal history of a similar proposal would materially improve the review.

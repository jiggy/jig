# Project Run Targets Authoring campaign

**Status:** accepted on 2026-08-29 for the narrow Project Authoring SDK/1
surface. This publishes one inert changing-source marker. It does not publish
a router, Semantic Choice, or a complete operational dynamic-dispatch path.

## 1. Exact result

Project Authoring SDK/1 now exports:

```ts
projectRunTargets()
```

as the exact frozen value:

```json
{ "kind": "project-run-targets" }
```

The value is valid only as a direct Flow-call slot source. It means the
complete structural Run-target catalogue of the immutable project Candidate
used during planning. It performs no discovery when constructed, carries no
query, ranking policy, provider, prompt, or authority, and cannot be nested in
`candidates()`.

Ordinary project evaluation, canonical re-normalization, Project
Authoring/1 validation, retained package linking, Lock/3, and Activation
Request/2 now use this one public representation. The former private schema,
evaluator entrypoint, helper types, and normalization path were removed rather
than retained as a compatibility layer.

## 2. Independent campaign

Two clean-room authors received only a checksummed packet containing the
candidate packed tooling, relevant public schemas and documentation, fixed
requirements, and finite checks. Neither author received repository internals,
the design-review archive, private administration material, or permission to
change the platform while consuming it.

Both independently produced the same intended project shape:

```text
one dispatcher Flow
    -> one Binding slot using projectRunTargets()

two zero-configuration direct Run Flows
    -> disjoint input schemas
    -> one Bun and one Python implementation
```

Neither submission added worker Bindings, Semantic Choice, Agents, Hooks,
Services, private imports, or invented platform APIs. Both passed strict
TypeScript checking, all three package checks, exact marker immutability, and
the packed Project Authoring/1 schema check. Both reviewers voted **GO** for
the narrow authoring value and **NO-GO** for operational routing claims.

The real retained project boundary separately evaluated an ordinary authored
Binding from one submission and derived the exact two-target expansion inside
the cgroup-v2/Bubblewrap proof envelope. That one-off campaign fixture remains
transient evidence; it is not committed as a design probe or Starter.

## 3. Repository evidence

```text
focused authoring/schema/catalogue       54 tests, 156 assertions
broader linker/lock/Plan                 74 tests, 381 assertions
packed @jigging/jig smoke                passed
isolated retained evaluator              1 test, 6 assertions
clean-room participants                  2 independent GO votes
residual Jig cgroups                     0
residual private-device directories      0
```

The campaign packet did not include two linked contextual specifications, a
Python SDK/runtime artifact, or a hermetically supplied TypeScript compiler.
Those are harness defects to correct before the next independent campaign.
They do not change this result: neither participant needed the missing
material to define or validate the inert TypeScript authoring value, and the
release-owner evaluator supplied the causal retained-boundary proof.

## 4. What is now public and what remains private

The earned public claim is limited to:

- `ProjectRunTargetsRef` and `projectRunTargets()` at the package root;
- use as one direct package-Binding slot value;
- its exact Project Authoring/1 machine shape; and
- the documented meaning that planning expands and pins the complete current
  structural Run-target catalogue.

The implementation already retains the source and exact expansion, filters
the complete pinned direct-Flow set, and durably dispatches one surviving
direct Flow or one narrow settings-only Bun Binding. Those host mechanisms
remain private evidence rather than public Resolver or administration APIs.

This checkpoint does not claim:

- that every structurally valid target is runnable for a particular call;
- complete authority, resource, liveness, or wait-graph filtering;
- public zero/many-survivor runtime error vocabulary;
- Agent-backed selection, Semantic Choice, reranking, or recursive routing;
- native dependency preparation or a production host installation;
- an operational Jig alpha; or
- Starter quality for either transient submission.

When multiple eligible survivors remain, ambiguity remains deterministic
unless a separately admitted chooser is available. A chooser may never widen,
truncate, sample, or replace the pinned candidate set.

## 5. Stop boundary

This campaign closes the authoring gate selected by reviews 160 and 168. The
next independent Agentic Routing campaign still requires a real
operator-installed Agent provider and durable no-rerank Semantic Choice. The
marker itself must not acquire prompts, filters, model names, strategy values,
or execution behavior merely to make that later campaign convenient.

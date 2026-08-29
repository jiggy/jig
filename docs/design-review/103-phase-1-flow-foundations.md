# Phase 1 FLOW foundations disposition

**Status:** completed on 2026-08-25. Run/1 and Run SDK/1 are frozen as the
prerelease foundation for later Jig phases. This is not an npm/PyPI publication
or a general third-party certification programme.

## What is frozen

The Phase 1 consumer boundary is deliberately finite:

- one root Run per process over full-duplex JSON-RPC stdio;
- `flow/run`, component-originated `flow/call` and `effect/call`, and
  notification-only `request/cancel`;
- bounded FLOW JSON/1 values and 16 MiB line frames;
- at most 64 unresolved component requests and 65,536 requests originated by
  either peer during one channel lifetime;
- stable semantic operation IDs, join/replay/conflict behavior, and
  `UNCERTAIN` without hidden redispatch;
- ordered terminal publication, cancellation, half-close, and process-exit
  rules; and
- the TypeScript and Python author surfaces named in Run SDK/1.

The author projection remains:

```text
serve(handler)
RunContext
RunResult
callFlow / call_flow
callEffect / call_effect
OperationError
EffectError
JSON value types
```

It does not expose JSON-RPC correlation IDs, Jig owners, Bindings, providers,
resolution, sandboxes, Services, Agents, or graph types.

## Executable evidence

The canonical command is:

```sh
bun run test:release
```

Unlike the fast development test, it fails when Python is absent. At source
commit `4738828`, the gate passed:

```text
Bun workspace and Run/1 corpus       330 tests
Python SDK                           37 tests
Independent Python host peer         21 tests
TypeScript package install smoke      pass
Python wheel and sdist install smoke  pass
```

The Bun and Python peers independently exercise both SDK components through
the shared framing/message corpus and the black-box behavior matrix. The
scenario-name manifest is only an inventory; executable cases, not matching
labels, provide the evidence. The Python sdist smoke allows normal PEP 517
build-dependency resolution and is not an offline-build claim.

## Instruction-restricted external-author gate

An initial author run was rejected during hostile review. Its brief required
conventional schemas but its supplied documentation omitted Schema/1, so the
author produced ordinary Draft 2020-12 schemas which the actual Jig compiler
rejected. Neither that package nor its evaluator report is used as Phase 1
evidence.

The corrected fresh TypeScript author received only:

- the public Package/1, Runtime Adapter selector, JSON/1, Schema/1, Run/1, and
  Run SDK/1 documents, including Schema/1 examples and its machine
  meta-schema;
- a fixed behavior brief;
- the packed `@flowmd/sdk@0.0.0` artifact with SHA-256
  `807ffa66ffbb934de310b918ff6f67acc87a2f30de61ac4d8d3a4f5dfb8f6f4b`;
  and
- a private inert-package checker with SHA-256
  `219587bd9b556af511eca118da4296ad698d324a50644caf03fd451e39637026`.

The author created a complete Flow with two concurrent child calls,
first-settlement selection, call-specific cancellation, loser observation,
one declared capability error, exact schemas, and no invented Jig API. The SDK
resolved inside the author-local installation rather than from repository
source. Strict TypeScript, the author's bounded three-scenario Run/1 harness,
and inert Package/1/Schema/1 inspection all passed. The admitted package digest
was `sha256:b5d553a9a427a7cb8fc99b25632a50067b596a98b740c7ef6b4035066db11d94`.

A second instruction-restricted evaluator did not read or trust the author's
report or harness. It copied the seven package files byte-for-byte into an
evaluator-local project, installed the same artifact locally, and independently
passed:

- inert Package/1 inspection and Schema/1 compilation;
- valid and invalid instance fixtures for all three conventional schemas;
- strict TypeScript checking;
- evaluator-local SDK resolution; and
- five bounded black-box Run/1 cases covering:

  - both calls appearing before either response;
  - normal first winner and explicit loser cancellation/settlement;
  - a late normal loser result;
  - `already-recorded` as a declared effect error;
  - exact preservation of a first-settled `OperationError` with no effect
    call;
  - exact root results; and
  - zero exit with no trailing frames.

Its separately bundled Schema/1 instance evaluator had SHA-256
`535d19435eb5e40433f9765715d7b4ea0ba2bd335de16c861ad68c95cafe5668`.

The agents shared the unrestricted workspace and were constrained by task
instructions, local manifests, local installs, and verified resolution paths;
this was not an OS-hermetic or access-controlled experiment. The claim is
independent authorship and evaluation, not filesystem sealing. The historical
workspaces were discarded rather than retained as product examples. The
repeatable author and evaluator contract is preserved under
[`conformance/run-1/external-author/`](../../conformance/run-1/external-author/);
future gates regenerate subjects, evaluators, and artifacts from the
then-current source rather than treating old probe output as product code.

## Deliberate limits

Phase 1 does not claim:

- a published stable SDK version or documentation site;
- durable Jig operation persistence across host failure;
- a production Resolver or child/effect dispatcher;
- Service/1, Agent, project-authoring, or host-administration APIs;
- sandbox activation or authority receipts; or
- that peak memory amplification at the maximum legal frame is a protocol
  conformance rule.

The operation tests use independent reference ledgers. Jig's eventual durable
store must separately prove crash recovery, fencing, and atomic replay.

## Change rule

Run/1 and Run SDK/1 are no longer an exploratory surface. Every compatible fix
must rerun the complete release gate and the instruction-restricted
author/evaluator gate defined under
[`conformance/run-1/external-author/`](../../conformance/run-1/external-author/);
it updates only the normative documents, machine fixtures, SDKs, and peers
affected by that fix. A semantic or wire-incompatible change requires explicit
version treatment rather than an implicit Run/1 reinterpretation.

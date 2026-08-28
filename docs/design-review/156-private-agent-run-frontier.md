# Private Agent Run frontier

**Status:** selected on 2026-08-28 as a staged private vertical. This record
freezes the first checkpoint before implementation. It does not publish an
Agent-provider SPI, provider registry, Agent Binding, projection ABI, or root
effect.

## 1. Why the vertical is staged

Agent Run combines four boundaries which must not be guessed together:

```text
exact Flow-local resource projection
    -> trusted provider registration and admission
    -> one real contained provider integration
    -> durable root effect ownership
```

The first checkpoint proves only the resource and result semantics. A fixed,
injected deterministic integration is test machinery, not an installed Agent
provider and not evidence that an in-process callback is a security boundary.
Later checkpoints may reuse the result, but they must not publish an interface
until a second implementation demonstrates that the abstraction is real.

## 2. First checkpoint: logical skill projection

One private operation receives:

- an authenticated retained Package/1 reference belonging to the calling
  Flow;
- the exact canonical Agent Run Capability Contract/1 descriptor;
- one Agent Run `run` input; and
- one trusted deterministic integration injected by the host test.

Before provider work, Jig validates the contract identity/version/digest, the
method input, any response Schema/1, and the `skills` selection. Skill names
must be Metadata/1 `LocalName`s, strictly increasing by unsigned UTF-8 bytes,
unique, and present as exact immediate `skills/<name>/SKILL.md` subtrees in the
pinned package. Omission selects none.

The integration receives values and an operation-scoped logical object
capability. It receives no package capture, package root, host path, caller
scratch, sibling Flow resource, ambient skill directory, or mutation handle.
The object capability can enumerate and read only the exact selected
subtrees, using paths relative to each selected skill. Each read returns fresh
bytes from the retained immutable Package/1 snapshot. Completing, failing, or
cancelling the operation revokes the complete view and releases the capture;
retained references fail thereafter.

The integration's result must satisfy the Agent Run output contract. When the
request contains `responseSchema`, `structured` is required and must satisfy
that compiled Schema/1 value. `blocked` and `limit` remain valid Agent domain
outcomes; malformed values, cancellation, provider failure, and response
schema failure are operation failures.

## 3. Required first-checkpoint evidence

Focused executable tests must prove:

1. omission selects no skills and exposes no package files;
2. a selected skill exposes its exact `SKILL.md` and support files, but no
   unselected sibling, package root, or host path;
3. multiple selected skills are deterministic and exact;
4. malformed, unknown, duplicate, or unsorted selections reject before the
   integration runs;
5. returned bytes cannot mutate the retained package or another read;
6. the projection is revoked after success, provider failure, and
   cancellation;
7. malformed Agent output rejects; and
8. `responseSchema` requires and validates `structured`.

This checkpoint adds no durable table and no activation-store schema bump.

## 4. Subsequent checkpoints

After the logical proof, the vertical may proceed only in this order:

1. close one private operator-installed provider registration/admission
   model, reusing the already reviewed `host-capability` Binding branch rather
   than inventing profiles or magic aliases;
2. run one exact deterministic provider out of process under the existing
   containment contract, realizing the same projection with read-only mounts
   or an equivalent provider-native view;
3. add durable Agent dispatch, terminal, uncertainty, closure, and parent
   release semantics to one root `effect/call`; and
4. give only the frozen consumed subset to an independent author/host peer.

Before the third step, root operation closure should be represented by one
stable internal aggregate over sorted subsystem evidence. Repeatedly adding a
new root-release field and database version for Journal, Service, Agent, and
future effects would be an accidental public taxonomy. The subsystems may
retain specialized state machines and tables.

## 5. Explicit exclusions and stop conditions

The complete Agent Run vertical excludes Session, Interactive, steering,
approvals, provider event streams, write-root sharing, model names, provider
options in FLOW, global skills, skill inheritance, instruction conductors,
Codex/Claude/ACP adapters, and Semantic Choice.

Stop and report instead of widening the slice if progress would require:

- treating a normal shared Service Mount's static files as per-operation skill
  projection;
- giving provider code a package or host path;
- making project source install or trust provider code;
- exposing a test callback as a public provider ABI;
- weakening the cgroup-v2/Bubblewrap proof for a provider runtime;
- replaying possibly dispatched Agent work; or
- adding provider- or runtime-specific vocabulary to FLOW metadata.

The immediate boundary is:

> Prove the exact, revocable, operation-scoped Flow-local skill view and Agent
> Run result semantics first. Then earn registration, containment, and durable
> dispatch separately.

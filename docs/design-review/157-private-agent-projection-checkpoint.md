# Private Agent projection checkpoint

**Status:** closed on 2026-08-28 for the logical projection and Agent Run value
semantics implemented in commit `66821ba`. This is not a provider,
registration ABI, containment proof, durable effect, or public SDK.

## 1. Exact bounded operation

`runPrivateAgentProjection` consumes an authenticated retained Package/1
reference, reparses the canonical Agent Run 1.0.0 Capability Contract
descriptor, snapshots one ordinary JSON/1 request, and validates it before an
injected integration is called. It never trusts a caller-supplied mutable
compiled-schema map.

Skill selection is empty by default. A nonempty selection must be strictly
ordered, unique Metadata/1 LocalNames, and every name must identify an exact
immediate `skills/<name>/SKILL.md` subtree in that retained package.

The integration receives one revocable logical object capability:

```text
names
files(selectedName)
read(selectedName, relativeLogicalPath)
```

It receives no package capture, host path, package root, project tree, caller
scratch, sibling skill, mutation handle, or ambient provider skill directory.
Reads return fresh bytes. Completion, failure, and cancellation revoke the
view and dispose the retained capture; an in-flight read rechecks revocation
after storage I/O before returning bytes.

The integration result is snapshotted once, validated against Agent Run, and,
when requested, its `structured` value is required and validated against the
exact supplied Schema/1. Accessor-backed, proxied, sparse, cyclic,
non-JSON/1, malformed, or schema-invalid values fail as operations.

## 2. Executable evidence

The focused corpus passes 9 tests and 45 assertions. It proves:

- empty, one-skill, and ordered multi-skill projections;
- exact support-file bytes and denial of siblings/escaping paths;
- fresh read buffers and post-terminal revocation;
- revocation after provider failure and cancellation;
- rejection of malformed, unknown, duplicate, and unsorted selections before
  provider work;
- canonical contract reparse despite a forged schema map;
- rejection of changed contract descriptors and accessor-backed request or
  result values; and
- base Agent output plus response-Schema/1 enforcement.

The Jig TypeScript build and focused corpus pass. The module remains under
`src/internal` and is absent from package exports.

## 3. What this does not prove

The injected deterministic callback is trusted test machinery. It can close
over ambient host state and is not an isolation boundary. Cancellation
revokes its package view but cannot forcibly settle an in-process callback
which ignores its signal. Package ownership is supplied as an upstream
authenticated precondition.

Therefore this checkpoint does not prove:

- operator installation, provider provenance, registration, or generation
  pinning;
- read-only filesystem or provider-native realization of the logical view;
- cgroup-v2/Bubblewrap containment of provider bytes;
- durable possible-dispatch, replay, uncertainty, or parent closure;
- Agent Bindings, instruction conductors, Session/Interactive, or Semantic
  Choice; or
- a provider ABI shared by two independent integrations.

The next valid step must close one private operator-owned provider registration
and exact contained finite operation without changing FLOW metadata or
presenting this callback type as the answer.

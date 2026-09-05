# Private Jig host

## Purpose

Owns Jig's trusted private machinery for admission, retained artifacts,
project and Run lifecycles, rootless Linux containment, dependency preparation,
child calls, and Agent providers.

## Ownership

- Activation planning, admission storage, project sessions, root controllers,
  and durable lifecycle state.
- Package artifact retention, materialization, and preparation.
- Installed Bun authentication, rootless acquisition, delegation,
  containment, supervision, and execution.
- Agent clients and launchers, capability enforcement, credential isolation,
  structured results, and package-local skill projection.

## Local Contracts

- Every `Private*` export remains package-private and is not an extension SPI.
- Strictly parse, bound, snapshot, and authenticate values crossing a trust
  boundary. Decoding inert bytes must not mint authority.
- Preserve the sequence observe, identify, plan, seal, admit, revalidate,
  execute. Never execute mutable project source or stale host evidence.
- Flow code receives no ambient host authority. Minimize environment, mounts,
  executables, network, credentials, and capabilities explicitly.
- The networked Bun preparation worker currently receives the complete captured
  package. Preserve the existing executable/configuration prohibitions and do
  not widen that view; prefer a manifest-and-lock-only projection when a
  concrete input seam can provide it without adding package-manager machinery.
- Provider credentials are host configuration and must not enter Flow input,
  project state, artifacts, diagnostics, or unrelated provider processes.
- Keep known Agent-configuration and dependency-preparation failures actionable
  through closed diagnostic codes and project-relative locations, never raw
  provider or worker messages. Missing Agent support affects only targets
  which require it.
- Deadlines and cancellation fence descendants, settle each terminal once,
  and complete bounded cleanup. Do not replay uncertain operations.
- Durable transitions use exact identities and conflict-safe commits;
  recovery must not create duplicate owners or official Runs.
- Exact child slots may select a Flow or a leaf Binding with its own admitted
  settings and Agent capability. An Agent operation belongs to that child
  context, not the root's operation namespace; fence and drain it before
  releasing the child owner. Children cannot acquire another child slot map.
- Fail closed on unsupported hosts, changed bytes, missing enforcement,
  malformed protocol, cleanup failure, or unverifiable provenance.

## Work Guidance

- Under the prerelease rule, replace old formats completely; do not retain
  readers, migrations, or aliases.
- Add negative, hostile, race, restart, and cleanup evidence for
  trust-boundary changes.
- Never start a fork storm, memory-pressure payload, or similarly hostile code
  until preflight proves complete delegation and the launcher guarantees that
  the payload begins inside its finished owner envelope.
- Do not weaken production checks for an unprovisioned unit test. Use private
  injection seams for units and the proof host for kernel behavior.
- A provider adapter may narrow common Agent authority, never widen it.
- One direct official OpenAI-SDK client and native Codex, Claude Code, and Pi
  are the owner-selected initial Agent breadth. Compatible endpoints remain
  protocol-specific host configuration; an endpoint, credential, provider, or
  model used in development must not become a product default.
- Keep each native client a thin profile over the common ACP lifecycle. A new
  client must not require FLOW changes, and a public provider/customization SPI
  requires independent installed consumers to earn its shape.
- Close missing evidence with focused tests; do not remove a selected client
  solely because prerelease live coverage lags.

## Verification

- Run the directly corresponding `packages/jig/test/` files, then
  `bun test packages/jig`.
- Containment, delegation, preparation, process-lifecycle, or Agent authority
  changes require the provisioned hostile-host suite and residue check.
- Run real-host suites sequentially within one delegated cgroup. Their strict
  acquisition and residue checks intentionally reject other concurrent Runs;
  the ordinary suite also includes host tests when delegation is present.

## Child DOX Index

- None.

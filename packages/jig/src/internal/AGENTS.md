# Private Jig host

## Purpose

Owns Jig's trusted private machinery for admission, retained artifacts,
project and Run lifecycles, rootless Linux containment, dependency preparation,
child calls, project commands, and Agent providers.

## Ownership

- Activation planning, admission storage, project sessions, root controllers,
  and durable lifecycle state.
- Package artifact retention, materialization, and preparation.
- Invocation file capture, sealed input projection, bounded anonymous output,
  and separate command-owned publication after execution fencing.
- Installed Bun authentication, rootless acquisition, delegation,
  containment, supervision, and execution.
- Agent clients and launchers, capability enforcement, credential isolation,
  structured results, and package-local skill projection.
- Channel integration resolves admitted package contracts and binds root
  output, exact child endpoints, or native Agent endpoints. Unused incoming rights
  may move onward; each child and effect retains its own participant identity.
  Child input, recipe, capacity and sealed-owner checks precede atomic transfer.
  Receiver disposal preserves an unused writer's transfer rights, not delivery;
  a disposed direct receiver makes later sends fail disconnected. Root and child
  contracts share one bounded cache.
  Broadcast subscription authority remains with the source creator; subscribers
  have isolated buffers and failures under unchanged aggregate lifetime bounds.
  ACP ingress is separately bounded and never
  blocks its protocol reader; failed progress does not manufacture failed work.
  The installed writer bounds live stdout/stderr and cancels on delivery loss.
- Project commands use reviewed Binding policy, sealed candidate bytes,
  installed Bun, and a collector outside candidate execution. Command owner
  rows and independent supervision survive coordinator loss without replay.

## Local Contracts

- Every `Private*` export remains package-private and is not an extension SPI.
- Strictly parse, bound, snapshot, and authenticate values crossing a trust
  boundary. Decoding inert bytes must not mint authority.
- Preserve the sequence observe, identify, plan, seal, admit, revalidate,
  execute. Never execute mutable project source or stale host evidence.
- Flow code receives no ambient host authority. Minimize environment, mounts,
  executables, network, credentials, and capabilities explicitly.
- Stage only captured manifests and the supplied root lock for Bun installation;
  materialize other authored files afterward. They must not trigger config
  loading, preloads, or foreign-lock migration. Supplied locks remain frozen.
  Missing-lock resolution requires explicit trusted per-review permission,
  separate from Run approval, before acquisition. Never persist that grant or
  infer it from project input, `--yes`, or an earlier review. Validate the
  generated graph before frozen installation; retain its exact bytes privately.
- Workspace capture reads declared ancestor membership and selected dependency
  source, never installed links. Recheck metadata, retain exact regular files,
  and recapture on review even when the Flow is unchanged. Resolve only known
  installer-created workspace links during collection; Runs receive no live
  workspace authority. Bun owns installation, not a parallel Jig resolver.
- Provider credentials are host configuration and must not enter Flow input,
  project state, artifacts, diagnostics, or unrelated provider processes.
- Native Codex subscription access comes from the current operator's
  file-backed Codex login. Project only its short-lived bearer; never embed a
  development login, retain its refresh token, mount `CODEX_HOME`, or expose a
  host keyring to Agent execution.
- Codex's nested sandbox uses its installation's exact bundled Bubblewrap,
  retained as provider support. The outer host's `JIG_BWRAP_PATH` does not
  select or replace that vendor-integrity-bound asset.
- Keep known channel-declaration, Agent-configuration and dependency-preparation failures actionable
  through closed diagnostic codes and project-relative locations, never raw
  provider or worker messages. Missing Agent support affects only targets
  which require it.
- Deadlines and cancellation fence descendants, settle each terminal once,
  and complete bounded cleanup. Do not replay uncertain operations.
- Durable transitions use exact identities and conflict-safe commits;
  recovery must not create duplicate owners or official Runs.
- Root attachments use invocation-owned descriptors and canonical file identity;
  hashes alone never grant file access. Captured bytes are not Package/1 inputs.
  Child and Agent contexts receive no attachment or destination authority.
- Keep execution settlement separate from delivery. Retain bounded output after
  writer fencing; publish once without replacement through the independent
  command owner. Coordinator loss must remove unpublished staging. Late failure
  preserves a known terminal or publication and never authorizes replay.
  Cancellation and expiry escalate against the exact trusted child after a
  bounded grace period and reap it; independent cgroup fencing still owns payload cleanup.
- Exact child slots may select a Flow or a leaf Binding with its own admitted
  settings, Agent capability, and reviewed project commands. An effect belongs to that child
  context, not the root's operation namespace; fence and drain it before
  releasing the child owner. Children cannot acquire another child slot map.
- Roots admit two Flow branches or one exclusive effect. Reserve each whole
  branch against the fixed aggregate root budget before dispatch; retain its
  reservation until confirmed fencing and cleanup. Kernel envelope limits and
  the recipe-bound reservation policy must agree. Leaves admit one effect;
  there is no queue, borrowing, recursive budget, or public scheduler.
- Channel operations have separate finite transport capacity, not worker slots.
  Unsupported delivery or capability wiring rejects before dispatch. Observation
  grants no session control; FLOW endpoint rights and source-owner lifetime
  remain authoritative. Keep channel state command-local, not durable replay state.
- Run Checkpoint uses one separate bounded control operation, not a worker
  reservation. Only the root's independent output owner accepts immutable
  aggregate bytes before acknowledgement. Bind exact Run, admitted method,
  captured input, project identity and coordinator epoch before dispatch.
  Interrupted publication uses accepted bytes only after complete fencing;
  recovery may settle that exact older Run but never submit or replay work.
  Keep rejected replacement, lost acknowledgement, owner lifetime, output
  collision and cleanup failure distinct. The owner retains no history.
- A project command receives immutable text and runtime mounts only: no Flow
  package, network, credential, or arbitrary executable. Host observations are
  process evidence, not an independent test verdict. Candidate bytes are copied
  from sealed descriptors into named files in a bounded private tmpfs, made
  read-only before payload execution so Bun can resolve modules safely.
- Fail closed on unsupported hosts, changed bytes, missing enforcement,
  malformed protocol, cleanup failure, or unverifiable provenance.
  Hold the trusted entry until the coordinator validates cgroup membership and
  any output handoff; short-lived commands must not race that check. Close the
  private continuation gate before candidate execution.
  Drain buffered supervisor control after process exit within a fixed bound;
  exit alone neither disproves a pending receipt nor establishes fencing.
- Resolve host tools from the fixed system locations, or Bubblewrap from the
  operator's absolute `JIG_BWRAP_PATH`, never ambient `PATH`. An explicit
  selection receives the same validation and cannot fall back on failure.
  Run loader support mounts the real glibc files, not a shim or whole Nix store.
  File-capture FFI and executable runtime support use the same loader selection.
  The fixed trusted Bubblewrap feature probe uses only read-only system runtime
  roots, never the host root or sysfs tree; its bootstrap mounts are not payload
  authority or proof of a Run's filesystem isolation.

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
- OpenRouter's natural credential/model pair is a convenience for its fixed
  compatible endpoint, not a provider registry. Ambiguous provider families
  fail closed. Explicit native Codex selection may resolve only fixed
  system-owned locations or an absolute operator override; exact executable
  and Bubblewrap bytes remain reviewed provider identity.
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

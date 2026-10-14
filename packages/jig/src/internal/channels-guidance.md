# Private channel integration

Apply these rules when the parent reading map selects this domain.
Read the [shared host contracts](AGENTS.md) before changing its implementation.

## Ownership

- Channel integration resolves admitted package contracts and binds root output,
  exact child endpoints, or finite ACP resource endpoints. Unused incoming
  rights may move onward. Each child and effect retains its own participant
  identity. Child input, recipe, capacity and sealed-owner checks precede atomic
  transfer. Receiver disposal preserves an unused writer's transfer rights, not
  delivery. A disposed direct receiver makes later sends fail disconnected.

  Root and child contracts share one bounded cache. Slot/channel creation
  references resolve the invoking package's declared dependency agreement, never
  provider files. Resolution creates no call or additional rights and shares the
  same cache as direct package-local paths. Broadcast subscription authority
  remains with the source creator. Subscribers have isolated buffers and
  failures under unchanged aggregate lifetime bounds. Agent updates accept
  direct or broadcast writers through the same admitted named contract.

  ACP ingress is separately bounded and never blocks its protocol reader. Failed
  progress does not manufacture failed work. The installed writer bounds live
  stdout/stderr and cancels on delivery loss. Read-only dashboard provenance is
  broker-captured accepted-send identity, retained on pending sends. It never
  enters public channel envelopes. Host call observations carry only actual own
  operation identity, parent, slot, bounded intent, state/time and safe cause.

  Optional observation exceptions cannot change dispatch or settlement.
  Successful root execution-owner admission emits one private best-effort
  dispatch observation before exchange, independent of update ports or views.
  The CLI owns and joins asynchronous screen entry. Earlier refusals remain
  ordinary diagnostics. Explicit result inspection owns one bounded immutable
  copy of verified delivery bytes. It never reopens destination files, retains
  an execution owner or extends a Flow's deadline.

  Release preview buffers and private presentation connections on every exit.
  Command reports retain aggregate-bounded diagnostics with host-assigned call
  paths, independently of root-process stderr. Settled root notifications let
  interrupted commands report known terminals without reopening closed
  authority.

## Local Contracts

- Channel operations have separate finite transport capacity, not worker slots.
  Unsupported delivery or invocation wiring rejects before dispatch. Observation
  grants no session control. FLOW endpoint rights and source-owner lifetime
  remain authoritative. Keep channel state command-local, not durable replay
  state.

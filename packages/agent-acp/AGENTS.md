# Ordinary finite ACP Agent

## Purpose

Make finite native Agent conversations independently replaceable Flows while the host
retains credential, process, and dispatch authority.

## Ownership

- `src/flow.ts` owns the ordinary Agent Run method and finite ACP dialogue.
  `src/conversation.ts` owns serial turn controls and essential replies; native
  dispatch authority remains in the resource, not this controller.
- `src/transport.ts` owns the public finite-ACP text framing helper; it neither
  authenticates nor authorizes a frame. The host validates reassembled JSON/0
  and independently enforces its reviewed finite protocol policy.
- `contracts/finite-acp/` mirrors `docs/jig/spec/contracts/finite-acp/` exactly.
  `FLOW.contract.json` and its three public channel descriptors mirror Agent Run.
- Package source, tests, descriptors and the bundled runtime form one artifact.
- `justfile` owns explicit build/test/pack recipes. Ordinary `bun pm pack`
  retains source and bundles with versioned development dependencies; no nested
  dependency archives or private manifest rewrites are part of distribution.

## Local Contracts

- Use only public dependency exports. No Jig imports, provider calls, process
  launches, implicit filesystem context, or credential access.
- One `native` slot supplies a finite ACP resource through required direct
  requests/responses channels. Its ready record supplies reviewed configuration;
  the Flow has no duplicate model, provider, mode or credential settings.
- Metadata declares `events`, `conversation`, and `sessions` as implemented
  Agent mechanisms. Those unconditional claims concern the method; current
  native support, turn/retention grants and actual settlement remain separate.
- Jig consumers may select this declared dependency with `npm:@jigging/agent-acp`
  in a local Binding; the Binding still grants the exact native client.
  Contract-keyed project selection does not create that grant or choose a vendor.
- Reuse `@jigging/agent-method` for prompt preparation and result validation.
  Complete ACP dialogue and resource settlement are separate requirements.
- Locally detected invalid ACP cancels the resource while preserving that
  parsing error. A terminal essential-channel failure awaits the resource's
  independent settlement without cancelling its result wait; root cancellation
  and deadline remain binding. Channel failure never replaces an eventual
  uncertain execution result or manufactures success.
  Optional public updates never supply execution evidence or authority.
  Their first loss or exhausted local relay bound discards the suffix and
  closes the writer with `error: 'LAGGED'`; no clean EOF hides incomplete output.
  Closed native warning notices go to console diagnostics, not answer text or
  public events; the host strips raw metadata and rejects authoritative errors.
- Optional conversational mode owns bounded direct commands/replies and per-turn
  results in `src/conversation.ts`. Native maxTurns, serial dispatch and interruption
  settlement remain host-enforced. One-shot calls retain their simple interface.
  Essential replies never use the lossy progress relay. Tools, MCP, binary
  transport, implicit replacement and retries are not provided.
- Optional session intent is relayed to the native resource; ordinary input
  remains null. Restoration requires the ready record's owned session ID and
  advertised resume support, never a new-session fallback. Resume returns an
  empty projected result; reapply every reviewed configuration before prompting.
  The Flow validates a requested final retention receipt only after independent
  native settlement and appends it to the final answer or conversation summary.
  A retained receipt requires natural zero exit with no signal; a valid answer
  can instead carry unavailable retention after confirmed cleanup.
  Unavailable receipts require the contract's closed reason; omission or unknown
  reasons are invalid. Storage, current authority, one-use claims and actual
  collection remain host-owned.
- Prompt settlement followed by clean request EOF delegates bounded process
  closure to its owner; the adapter does not wait for optional ACP close.
- `./transport` is bounded framing, not an alternative host authority filter.
  A frame receipt does not prove dispatch, completion, or cleanup.

## Work Guidance

- Keep ordinary behavior in the package and independently enforceable policy
  in the host. A fake peer test is not qualification of a native client.

## Verification

- `bun test packages/agent-acp/test` exercises pure framing and public RunContext
  wiring using in-process channel/resource peers.
  Session cases cover resume ordering, exact owned identity, readiness/capability
  failures, final-only receipts and invalid retention facts. These deterministic
  checks do not qualify native saved-state restoration.
- `just build` compiles declarations/public transport and bundles `src/flow.ts`.
- `just pack --destination <directory>` builds and packs explicitly. For existing
  output use `bun pm pack --ignore-scripts --destination <directory>`.
- Package tests import the relocated bundle without development dependencies,
  check source and ordinary dependency versions, and repack without workspace
  resolution. They do not qualify a native client or host containment.

## Child DOX Index

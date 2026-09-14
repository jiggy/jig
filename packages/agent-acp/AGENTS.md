# Ordinary finite ACP Agent

## Purpose

Make one native Agent turn an independently replaceable Flow while its host
retains credential, process, and dispatch authority.

## Ownership

- `src/flow.ts` owns the ordinary Agent Run method and finite ACP dialogue.
- `src/transport.ts` owns the public finite-ACP text framing helper; it neither
  authenticates nor authorizes a frame. The host validates reassembled JSON/1
  and independently enforces its reviewed finite protocol policy.
- `contracts/finite-acp/` mirrors `docs/jig/spec/contracts/finite-acp/` exactly.
  `FLOW.contract.json` and `contracts/acp-public-updates.json` mirror Agent Run.
- Package source, tests, descriptors and the bundled runtime form one artifact.
- `justfile` owns explicit build/test/pack recipes. `scripts/pack.ts` stages
  complete public SDK and Agent method archives, records their identities and
  digests, and uses file dependencies only in the packed manifest.

## Local Contracts

- Use only public dependency exports. No Jig imports, provider calls, process
  launches, implicit filesystem context, or credential access.
- One `native` slot supplies a finite ACP resource through required direct
  requests/responses channels. Its ready record supplies reviewed configuration;
  the Flow has no duplicate model, provider, mode or credential settings.
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
- This package does not add follow-up, session replacement, tools, MCP, binary
  transport, retries, or reusable sessions.
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
- `just build` compiles declarations/public transport and bundles `src/flow.ts`.
- `just pack --destination <directory>` builds and packs explicitly. The
  script accepts existing builds and optional `FLOW_SDK_PACKAGE_ARCHIVE` and
  `AGENT_METHOD_PACKAGE_ARCHIVE` inputs matching selected package identities.
- The package test imports the relocated bundle without dependencies installed,
  checks complete dependency archives, repacks them unchanged and rejects
  inventory tampering. It does not qualify a native client or host containment.

## Child DOX Index

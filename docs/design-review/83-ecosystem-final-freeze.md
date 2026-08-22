# Ecosystem final freeze audit

## Verdict: PASS

No release-boundary contradiction remains in the current architecture.

The prior blockers now have one independently implementable reading:

- **Runtime identity:** one exact content-addressed bundle commits every
  normative artifact; Package code never selects argv or a runtime by suffix.
- **Conformance layering:** Package/1, Run/1, Service Contract/1, and Service/1
  have an explicit dependency firewall. A Run-only host may support opaque
  effects and rejects unsupported typed profiles before launch.
- **Service optionality:** Service is official and separately gated, while a
  Package/Run host incurs no Mount, generation, or Contract-consumer
  obligation merely by parsing Service metadata.
- **Package mode:** one exact package is either Run-capable or Service-capable
  in v1, and one Binding records that immutable mode. No dual-mode or
  Markdown-interpreted Service ambiguity remains.
- **Service lifecycle:** initialization begins with dependency revision 0;
  readiness names an installed revision; status removal is immediate;
  graceful drain rejects new leases while existing leases may continue calls;
  final lease release/deadline closes admission and cancels the pending Mount.
- **Operation ownership:** one live inbound request owns operations, terminal
  response enters an explicit quiescence phase, and EOF/trailing-frame races no
  longer have two plausible terminal outcomes.
- **Journal and Hooks:** the canonical Journal is explicitly host-native Jig
  behavior, not a portable Journal/1 or mounted-provider claim. Its transaction
  can therefore order append, ledger result, Hook selection, and activation
  boundaries without a fictitious distributed transaction. Service Contract/1
  describes only the slot's JSON values. Hook input validation is performed on
  each concrete Event and creates at most one derived Run, including on
  `INVALID_INPUT`.
- **Security:** portable v1 permissions are reduced to named attachment
  authority plus denial of ambient environment, raw network, and child
  processes. Unproved Grant Profiles are removed rather than left as unnamed
  conformance claims.
- **Public identity:** package provenance/content, Runtime bundles, Service
  contract descriptors, provider generations, and local activation evidence
  remain distinct and exact. Semantic ranking cannot alter any of them.
- **Starter safety:** `init --from` resolves and previews an inert snapshot,
  materializes transactionally, and runs any initializer only as a separately
  approved ordinary Flow with no installer-only authority.
- **Adoption boundaries:** Caskada receives no privileged path; Cordis is
  bridged only at the bounded serializable Service seam; arbitrary DSH UI,
  callback, stream, and JavaScript-object portability are explicitly not
  claimed.

The remaining work named in section 15 is specification and implementation
evidence required before individual `1.0` labels. It does not require another
architecture change. In particular, machine schemas must encode the stated
conditional Package fields and black-box suites must prove the lifecycle state
machines, but those are already release gates rather than unresolved design
choices.

The freeze therefore passes with the existing nonclaims intact. Callback
handles, subscriptions, telemetry, raw-authority profiles, compatible version
ranges, channel resumption, multiple implementation faces, and portable
Journal/Hook semantics must not be pulled back into v1 without a new profile
and its own evidence.

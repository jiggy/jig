# Expected failure walkthroughs

## Candidate count boundaries

- G0 has zero survivors: commit `BINDING_MISSING` with the pinned empty
  snapshot. A later G1 apply cannot repair that operation.
- G1 has one survivor: select `echo-upper` directly. Semantic Choice is not
  consulted.
- G2 has two survivors: without a configured compatible ranker, commit
  `BINDING_AMBIGUOUS` with both exact IDs and rejection/eligibility evidence.
- A synthetic fixture adds 255 more eligible default-derived Runs to G2, for
  257 surviving exact revisions. The admitted `allRuns()` snapshot contains
  all 257 in unsigned UTF-8 LocalName order, but the Semantic Choice request is
  never built. Jig commits `BINDING_AMBIGUOUS` with
  `candidate-limit-exceeded`, the full snapshot identity, and survivor count
  257. It never truncates to 256, samples, batches, or makes 256 an admission
  limit for the catalogue.

## Generation safety

- Adding or removing a qualifying package changes the candidate aggregate.
  Without plan/apply, no active snapshot changes.
- Applying against the wrong base generation or changed captured bytes returns
  `STALE_PLAN`; it cannot publish a mixed dispatcher/default generation.
- Deleting a candidate from source while a G2 Run is active cannot mutate that
  Run's pinned snapshot or Package/1 bytes.
- An authored Binding later owning `echo-upper` suppresses the derived default
  of that ID and contributes its exact configured revision to the next
  snapshot. It does not merge with the default.

## Resolution safety

- The dispatcher omitting `delegate` is `BINDING_MISSING`; the catalogue never
  opens implicitly.
- The active ancestry removes all survivors: commit `BINDING_MISSING` with
  ancestor-filter evidence; do not re-add the owner or reroute.
- One child returns the wrong JSON shape: dispatcher returns its declared
  `blocked` outcome. Semantic similarity is not type compatibility.
- A missing Bun/Python Adapter or enforcing Sandbox Backend makes the affected
  Binding unavailable. Jig never falls back to Markdown unless separately
  allowed by explicit policy.
- A package attempts network, environment, process, project-tree, extra-FD, or
  host-IPC access: the enforcing boundary denies it; `allRuns()` conveys no
  ambient authority.

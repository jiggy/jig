# @jigging/jig

## 0.1.0-alpha.53

### Minor Changes

- 8b9b731: Make native ACP client selection an operator choice by default when a Binding omits `client`. Interactive review asks for a qualified client, noninteractive review accepts `--agent`, and explicitly pinned clients are preserved alongside the operator default.

### Patch Changes

- 624cd30: Permit ACP grants to select a separately reviewed named operator authentication profile without embedding credentials in project source.
  Keep workload model choice separate from the authentication profile, reject missing or ambiguous client-specific credentials, and isolate selected profile bytes from ambient and sibling accounts.
  Bind the named profile to native provider identity and refuse a cross-client review override that would reinterpret its authentication scope.
- 624cd30: Upgrade the ACP agent transport and Jig finite ACP host to ACP v2 only, removing v1 protocol compatibility. Support insertion acknowledgement, agent-owned message identifiers, content upsert handling, terminal foreground state, required session close, and updated Codex, Claude, and Pi ACP adapters.
  Deliver native candidate recovery across optional `backup1`–`backup3` slots with `uses.<slot>.optional`, host-attested `not-forwarded` and `rejected-without-output` failure boundaries, confirmed pre-dispatch failure metadata, and confirmed cleanup. Preserve Codex session continuity across compatible same-client authentication profiles with atomic pre-acceptance release.
- c49427f: Reject available attempt artifacts without manifest digests and keep checkpoint-associated file identities root-relative.
- e8cc33f: Accept legacy uppercase package names in Bun lock policy and package selector.
- 90f684e: Qualify Linux and macOS runtimes to Bun 1.4.4 revision 38afee6c84fcf48c0edb2466aa4b27d287a59c30 and enforce pure evaluation in shell.nix.

## 0.1.0-alpha.52

### Patch Changes

- 929372d: Accept Codex subscription token metadata while preserving the private bearer projection and credential checks.
  Report unsupported authentication fields with specific recovery guidance that preserves the operator's login file.
- 1a0c21d: Report unsupported schema keywords in dependency-backed Flow contracts as invalid authored candidates.
  Preserve workspace contract paths and JSON pointers, name the unsupported keyword, and keep preparation paths private.
  Retain malformed-contract field diagnostics for ancestor workspace packages without relaxing location validation.
- 995ad54: Show observed connections and mixed request states on the Run map, with local focus for active and uncertain or failed requests.
  Link invocation details to exact child-authored views while preserving selection, map position and observation limits.
- 8c3449c: Retain closed Run-status failure phases and codes in opt-in private profiles before public diagnostics discard internal details.
  Keep error observation bounded and preserve the original command outcome without recording messages, paths, or payloads.
- e80b0ea: Apply material presentation across root and child views, make host inspectors optional, and preserve readable scope and responsive navigation.
  Improve application evidence layouts, stopped progress, output access and correspondence, with mounted browser acceptance coverage.

## 0.1.0-alpha.51

### Patch Changes

- ddd8247: Allow larger reviewed Flow libraries through bounded dependency preparation counts in jig.ts or the operator environment. Preserve aggregate byte and time budgets. Report the exhausted count, effective limit, source, and supported remedy.
- 611749f: Report unsupported child checkpoint composition at the caller's slot instead of an internal review failure.
  Explain root execution through the application client and preserve actionable child attachment diagnostics.
- f1ea467: Compose checkpoint-enabled methods through reviewed child Flow routes.
  Retain a separate latest checkpoint for each invocation under its original root attempt, with shared bounds and authenticated ancestry.
  Add the native Child Checkpoint contract so an active parent can retrieve a settled direct child's saved work and associated artifacts.
  Expose bounded checkpoint scope inventory and selection through application result and export operations without replaying execution.
- c25d356: Explore approved workflows before execution, inspect their configured connections and input contracts, and launch ordinary Runs with explicit JSON input.
  Keep project control separate from Run observation, with exact approval checks, bounded requests, and ordinary cancellation and cleanup.
- f1425ce: Add a read-only application map to live browser inspection.
  Show the exact admitted components and available child calls beside observed invocations.
  Component selection opens matched call evidence without changing application-owned landing pages.
  Preserve distinct Bindings, missing observations, and bounded composition limits.
- 3863ad6: Wait for storage preparation tasks to leave the Mac guardian coalition before preparing a payload, within existing deadlines.

## 0.1.0-alpha.50

### Patch Changes

- a58e77f: Direct cleanup recovery diagnostics to the shared Troubleshooting guide.
- 30490fd: Preserve separate, bounded operation and close failure classifications when project cleanup cannot be confirmed.
  Keep private exception content hidden and explain recovery without replaying uncertain work.
- 6e641c2: Allow review to capture explicitly selected mounted workspace roots with repeatable `--source-root` operands. Reuse the selected application root while preserving bounded capture, protected-root checks, immutable snapshots, and mount restrictions inside each package.
  
  Preserve closed workspace source failures and project-relative locations so mount boundaries, missing source, links, and access failures receive actionable diagnostics.
- 9089b55: Preserve refusal and limit outcomes with their original text when structured
  output cannot be decoded or does not match the requested response schema.
  Include structured data only when it validates, without promoting a partial
  answer to completion. Completed answers and independently supplied structured
  results remain strict.
- 9373d9b: Recommend the FLOW and Jig authoring skills in generated project READMEs, linking to the shared installation guide.
- 760d855: Route documentation links to the task-focused Jig guides. Preserve the documentation license coverage after moving explanatory pages.
  
  Retain bounded private package-verification causes during qualification. Correct the existing stale-plan exit expectation after successful cleanup.
  
  Select Bun 1.3.3 for Linux qualification and execution while retaining the qualified Mac runtime.
- 3b95d1b: Build Linux candidates with Bun 1.3.13, preserve Jig's authoring exports, and use its pinned runtime. Explain unsupported registry sources in dependency locks with actionable repair steps.
  
  Allow standalone Flows to ignore unrelated ancestor workspaces.
- 7effb0f: Restore the application workbench hierarchy with compact navigation, readable reports, photograph galleries and captured documents.
  Add portable document covers, chapter locators, verified downloads and readable application instance labels in both reporting SDKs.
  Resolve forwarded output references through verified publisher and attachment bindings while preserving packet paths.
  Retain bounded document-sized raster previews while preserving SVG, decoder memory and source limits.
  Preserve event identity, captured-source access, filter-clear focus and header-only delimited tables across application layouts.
  Preserve Linux input descriptor custody across subprocess finalization and reuse.
  Keep exact cross-subject references, accessible cover evidence and separate SVG preview reservations, and render bounded raster-containing SVG documents.

## 0.1.0-alpha.49

### Patch Changes

- a6ddb50: Select the reviewed Responses gateway before native Codex starts, preventing provider mismatch failures while keeping credentials in the private ACP exchange.
- b594473: Run captured declaration evaluators directly from bounded stdin programs, avoiding unnecessary Mac filesystem images during review while preserving fresh isolated evaluation and cleanup.

## 0.1.0-alpha.48

### Patch Changes

- fff6332: Preserve closed native request failure reasons without exposing provider messages or replaying uncertain work.

## 0.1.0-alpha.47

### Patch Changes

- f277e9a: Clarify the bundled license map for the new Jig homepage and its separately licensed fonts.

## 0.1.0-alpha.46

### Patch Changes

- 28d20a4: Explain incompatible project requirements before evaluation and detect stale contributor builds on invocation. Projects declare tested host versions in engines.jig without adding runtime dependencies. Installed users receive bun/npm installation guidance. Contributor builds receive repository rebuild guidance.

## 0.1.0-alpha.45

### Patch Changes

- 578e204: Retain a validated native-reported HTTP error status alongside closed Agent session failure categories. Keep raw provider data private and preserve failure, uncertainty, cancellation and cleanup rules.

## 0.1.0-alpha.44

### Patch Changes

- 48bd119: Allow production dependency preparation output budgets in jig.ts or the operator environment. Report the exhausted limit and its effective source. Add a central limits reference and checks that keep documented defaults aligned with their owners.
- ecaa82e: Add application view targets, gallery roles, formatted reports, captured media,
  and explicit bounded collection previews. Coalesce whole live snapshots within
  publication epochs and expose matching TypeScript and Python authoring helpers.
  
  Retain explicitly selected final display bundles as atomic application editions.
  Add revision checks, original receipt recovery, exact captured evidence, and
  read-only CLI and web inspection. Keep retained presentation independent of Run
  execution and application freshness.
  
  Select the exact Apple Silicon Darwin 24.6.0 build 24H232 profile. Bind hosted
  qualification to each architecture's selected kernel, build, and native runtime.
- 4567044: Recheck absolute presentation deadlines before expiring delivery inspection or command completion, so early timer callbacks cannot refuse work before its bound. Preserve the original deadline, cancellation and settled outcomes.

## 0.1.0-alpha.43

### Patch Changes

- 84f51c2: Preserve bounded phase and process evidence in Project Evaluation operation errors when evaluation stops at a deadline or is cancelled, while retaining cleanup and failure guarantees.

## 0.1.0-alpha.42

### Patch Changes

- 35eda88: Preserve the native client's bounded failure category when an ACP conversation fails. Keep provider text private and preserve uncertainty, cancellation, and cleanup.
- e9c727f: Qualify native conversations against the exact release candidate packages. Retain bounded native failure classifications and independent macOS qualification failures before publication.
- d576c44: Retain bounded host failure causes, preparation outcomes, materialization and controlled-evaluation timings in the optional installed-command profile. Preserve known dependency-preparation diagnostics during initial npm Flow adoption. Keep private error content out of diagnostics and preserve execution and cleanup behavior.
- 142e372: Avoid repeated directory walks and intermediate directory syncs during package materialization. Reuse the original materialization lease when settling a completed evaluation phase, avoiding a redundant recovery capture. Preserve full identity and content checks, durable recovery, and the original execution deadlines.

## 0.1.0-alpha.41

### Patch Changes

- acab064: Preserve cancellation requested before sealed Linux admission, even after deadline expiry, while retaining authenticated owner cleanup.

## 0.1.0-alpha.40

### Patch Changes

- 1f7d155: Generate independent alpha versions and dependent pins from reviewed release notes.
  Preserve qualification-only status for reporting and display artifacts.
- d2b80a3: Report authenticated Linux preparation expiry as a deadline after fencing and cleanup, instead of an unconfirmed launch failure.
- 31627ed: Preserve cleanup verification when systemd collects an exited transient scope before its cgroup path is resolved.

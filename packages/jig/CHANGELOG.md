# @jigging/jig

## 0.1.0-alpha.59

### Minor Changes

- e55d148: Export the retained final result of a successful packet-producing Run by its
  Run ID from the original project directory. Recover files after a delivery
  failure without executing the Flow again.
- 2198be7: Add reviewed offline tool slots for exact binary input and output within a Run.
  The Linux candidate verifies an operator-provisioned Nix runtime and uses
  Jig's existing resource, cancellation and artifact custody rules.

### Patch Changes

- 6715c81: Allow an ACP grant to require exact reasoning effort. Jig shows the
  requirement in review and checks it before forwarding prompts and starting
  native turns.
- f334272: Deliver, recover, and inspect Run packets that combine more than 64 files
  across individually bounded artifacts. Packet recovery preserves the original
  Run ID and verifies every delivered file.
- 4564c3c: Count a shared dependency capture once per review while charging each retained
  execution layout. Report aggregate preparation overflows against the project.
- 1cf3501: Route the dependency installer's HTTPS requests through an operator-selected proxy during review.
  Keep lock validation, the default registry, and explicit permission for missing-lock resolution.
- 8915e09: Guide new Jig projects through composition checks, explicit review, and a greeting Run with inline JSON input.
  Allow `jig init` in the current directory and print one README handoff for every mode.
  Ship local FLOW and Jig authoring skills and preserve the DOX hierarchy in every new project.
  Record the upstream skill sources for project updates.
  Add a Bun test to the greeting and an opt-in kitchen starter that builds a weekend roster and verifies each assignment call.
  Keep the kitchen fixtures in `tests/fixtures` for the tests, CLI, and Explorer.
- bfd3224: Bundle the newest FLOW authoring skill in canonical npm candidates.
  Build from source without a FLOW fetch and warn when its skill needs separate installation.
- f386e96: Report a confirmed payload SIGKILL as an execution failure even when its output
  stream closes before native completion is reported.
- a5f6bc8: Report unresolved prior Run cleanup separately from contention for a project
  session. Preserve the original reconciliation ticket and protected evidence.
- 152cc1c: Report conflicting finite ACP runtime mounts during review. Review and execution
  use the same projection and coalesce identical files at the same destination.
- 14e307d: Allow operators to route reviewed HTTPS requests through an explicit CONNECT proxy with `JIG_HTTP_REQUEST_HTTPS_PROXY`.
  Keep the exact HTTP grant, TLS verification, private credentials, and contained-worker cleanup.

## 0.1.0-alpha.58

### Minor Changes

- 1d5d13a: Open a comparison of two saved Run packets in the local browser inspector with `jig inspect --result EARLIER --compare LATER --display web`.
- 3251352: Compare two saved Run packets with `jig inspect --result EARLIER --compare LATER`. Reopen the recorded call paths after the Runs exit and see differences, matches, and gaps in observation.
- 9b5bed9: Reload the last accepted input and compatible uploads after reviewing a new approval. Compare retained call paths, targets, outcomes, and counts for the last two Explorer Runs.
- 08ad6b5: Load a local JSON file into Explorer's input editor. Inspect or edit the draft before choosing **Run workflow**.
- 5c3d5d9: Read child-call evidence with `jig run --record-calls --json` without creating a result packet for result-only Flows.
- 2b67583: Save bounded child call evidence with `jig run --record-calls --out DIR`. Reopen and verify it with `jig inspect --result DIR --calls`.
- 2cf3f33: Read a bounded comparison of two explicitly selected saved Run packets with `jig inspect --result EARLIER --compare LATER --json`.
- 8d593e3: Generate optional TypeScript checks for Binding package selections, slot names,
  and settings with `jig types --project`.
  `jig specialize-slot` preserves the generated type check in literal Binding declarations.
  `jig check --diff` and review show the changed Binding slot and the original caller routes and selectors that remain configured.

### Patch Changes

- 4e3745e: Find handoffs in the last locally approved configuration with `jig inspect --flow --find TEXT --approved`. Results identify the retained revision and keep focused inspection on the same basis.
- 4725ddb: Add `jig check` to link working project configuration before review. Use
  `--diff` to compare changed targets and configured selections with the last
  local approval, and `--json` for structured output.
- bea5d03: Copy a configured route from the Run map even when it has zero matching retained requests. Include its slot path, retained evidence, and focused topology command.
- 8a4f345: Copy an investigation brief from a live Run invocation. It identifies the caller, slot, observed state and any application outcome. It includes exact configuration matches and a source inventory command.
- e912cf0: Declare a collaborator in an existing code Flow with `jig add-use`. Jig copies the validated invocation agreement and adds one slot to the existing metadata. The author chooses when to call the slot and configures its target before check and review.
- 0365057: Use `jig add-use <package-path> <slot>=<source> --optional` to declare an optional collaborator.
  Jig copies the identified agreement and writes the optional requirement in one source edit.
- 1b7f5c5: Declare an uncontracted collaborator slot with `jig add-use <package-path> <slot>`.
  When a valid invocation agreement lacks portable identity, Jig points to this form.
  Choose the target in the caller's Binding and approve the revision separately.
- d834191: Generate a project-owned AGENTS.md that helps coding agents locate workflow edits. The inspection index shows shared caller slots beside the selected target's outgoing slots and links to the Binding declarations.
- 762c2d9: Reduce repeated compilation and normalization setup when Jig evaluates project declarations. This speeds up working-tree inspection and review, especially in projects with many Bindings.
- bf6451b: Find a configured workflow handoff by slot, target name, or captured description with `jig inspect --flow --find TEXT`. Follow the caller's source, exact Binding wiring, and other uses of its shared destinations.
- d09d779: Start copied Run investigation briefs with a topology command focused on the exact Run root. Keep the caller and slot as source lookup cues.
- fdff6b3: Group authored caller decisions by slot in Flow inspection. Compare differing literal inputs and conditional fields at their source locations, with possible overrides and omitted sites shown beside the corresponding slot.
  
  The report links to additional call sites when a slot exceeds the detailed view.
- 902dfcc: Open working-tree Bindings from declaration paths in `jig inspect --flow`.
  Show each shared Binding's caller slots beside its independent Run selector,
  and guide coding agents to give one caller its own Binding when a child
  selection needs to differ.
- a1e04f4: Inspect a Flow by its project-relative file path. Jig opens the sole configured use or lists the uses of the owning package. Unknown inspection selectors now point to complete topology for the current or approved configuration.
- b135057: Include the visible Run root in copied invocation briefs so a coding agent can narrow source inspection to the application it came from.
- bbe2243: Show late changes first in Explorer's comparison of two settled Runs when the retained call trees fit the current settlement allowance.
- 49a34cc: Find configured workflow names with spaces in place of hyphens or underscores. If a phrase has no matches, Jig shows how to retry with one word.
- 75dcda6: Save result-only Run packets without reserving space for file artifacts. Keep artifact capacity for Runs with writable ports, forwarded results, or checkpoint grants.
- 8abb2d0: Prioritize nonmatching paths in browser comparisons of saved Runs, retaining full counts on every displayed path.
- 17baa1a: Keep generated workflow-edit guidance focused on finding the relevant route
  with `jig inspect --flow`. Focused Binding inspection gives caller-specific
  configuration advice when several slots select the same Binding.
- 277e193: Add `jig specialize-slot` to give an exact caller slot its own Binding of a
  shared Flow. Use discovery or a literal bindings array. Select a different
  child in the copy and preserve the original Binding, its callers, and prior approval.
  
  Link opaque Reporting wrappers to the callback and any resolved local handler
  in `jig inspect --flow`, while keeping route coverage unresolved.
- 932c951: Show the link from a Flow's returned value to the caller's check and next handoff in focused inspection. The same relationships are available from the caller, with links to the call expansion and source.
  
  See other configured uses of an incoming caller's code grouped by the target they select for the same slot. The report links each displayed use and the selected Binding declaration.
  
  Put a direct Flow's required input and modeled returns beside its selector. Follow a caller's next handoff through its known result to the caller's return when the same path establishes both.
  
  Link the captured executable file from local Flow and Binding views, including alternative targets shown at incoming slots.
  
  Show differing input fields across slots that target the same Flow and give their wiring links once per configured use.
  
  Show different modeled inputs and results at the same write site. Combine entries that share the same displayed case.
  
  Link configured caller slots to their Binding declarations and explain how to vary configuration when callers share a Binding.
  
  Show the selected Flow implementation and its configured child slots beside caller decisions.
  
  Put focused caller decisions beside shared Binding wiring and show both sides of an authored slot choice together. Link application-map decisions to their configured destination sections.
  
  Link peer Binding declarations and the package settings schema in focused inspection. Show where to configure behavior specific to one use when Bindings share a Flow.
  
  Show earlier returns and any independent entry alongside a caller's modeled next call.
  
  Show the exact Run selector beside focused source links. Identify packages whose captured invocation targets all use Bindings.
  
  Show related Bindings and their exact alternative slot targets when inspection opens at the default entrypoint.
  
  Show the settings schema path beside shared Binding choices, including when finding a decision through one of its callees.
  
  Link independently callable local Flows beside the caller's next handoffs. Identify each selected Binding that uses the same Flow.
- 5d7773c: Generate TypeScript declarations with `jig types` from a Flow's declared
  slots, package-local invocation contracts, and validated settings schema.
- 14437bf: Check a TypeScript Flow's input and returned outcomes with types generated from
  its invocation contract by `jig types`.
- 2078f92: Link exact captured Binding declarations from working-tree topology.

## 0.1.0-alpha.57

### Patch Changes

- 727abeb: Show possible behavior from approved source in the explorer and the Run's Application map. Show returned call outcomes, reported progress, and verified file names with the selected Run.
- dbb1c02: Show conditional routes and validation outcomes in Flow inspection.
  Use supported input contract guarantees to omit impossible branches in standalone source analysis.
- 4922e6d: Show source behavior by default in `jig inspect --flow`. Capture a baseline with `--snapshot`, then use `--compare` for source-linked changes to configured uses, calls, results, and effects. The diff also surfaces newly captured call order when complete paths cannot be matched. Add `--all` to see complete changed paths. Use `--topology` for configured connections.
  
  Use `jig inspect --flow --package PATH` to find a Flow package's configured uses, direct caller slots, and settings differences.
  
  Package lookup errors show the inspection command. Focused reports retain authored call locations, including computed slots, after source analysis stops.
  
  Inspection can trace a computed slot through a local helper to an authored lookup table, its key sources, and related early exits.
  
  Follow returned Reporting wrappers and helper promises through block-bodied functions. Working-tree inspection explains evaluator failures and points to retained topology when an approval exists.
- cfa4578: Choose input files for a workflow in the browser explorer. Reuse the same files across approved workflows and compare the last two Runs.
- 2977b5d: Open a compact Flow navigation index when inspecting a project without a declared entrypoint. Find shared packages, configured slots, and focused inspection commands without analyzing every target.
  
  Link working-tree inspection directly from captured packages and show request metadata separately from child input in focused caller decisions.
  
  Show which local helper arguments supply each authored request field in focused reports and application map expansions.
  
  Keep authored caller decisions beyond the application route limit and show the source of the last progress request beside its count.
  
  Link identifiable progress expressions and preserve call-case links when a proved check leaves the continuation intact.
  
  Show required slot wiring beside source routes and link local package declarations.
  
  Connect earlier authored exits to the call sites they bypass when route analysis stops first.
- dceb6fd: Show Flow package boundaries and matching configured calls in source inspection.
  Review rejects a supported relative runtime import outside the Flow when its module is absent from the captured execution files.
- 2f2650e: Accept a bare Flow package path in `jig inspect --flow` and print focused inspection commands for its configured uses.
- 40ed298: Show authored caller decisions in focused Flow inspection.
  Connect a slot argument to its local dispatch helper, conditional fields, and other configured uses of the Flow.
- 8c15213: Prepare a new Jig prerelease whose macOS qualification can retry transient
  GitHub metadata read failures. Publication still requires complete native
  coverage for both supported macOS majors on the exact release candidate.

## 0.1.0-alpha.56

### Minor Changes

- 9577813: Add an explicit recovery-only `client.reconcile({ ticket })` and `jig attempt reconcile --json` for accepted attempts whose foreground coordinator was lost. Reacquire the trusted project owner to fence and settle older durable work without preparing, submitting, or replaying the original Flow. Refuse active ownership or cleanup that cannot be confirmed; preserve the original ticket and retained checkpoints.

### Patch Changes

- a077f4a: Keep Claude Code authentication-status notifications inside the bundled ACP
  adapter. Previously, unsolicited identity notices could stop the finite ACP
  exchange before Jig forwarded the first task prompt. The workspace build
  inputs and canonical qualification archives now use the corrected patch.
- af59d37: Add opt-in source behavior inspection through `jig inspect --flow --behavior`. See caller continuations and reported effects for supported TypeScript, with explicit gaps for opaque behavior.

## 0.1.0-alpha.55

### Minor Changes

- 767d40e: Add explicit Markdown inspection of current configured topology, including distinct Bindings, caller slots, selected resources, and approved-snapshot selection.
  Focused inspection retains caller paths, other caller slots and shared package uses, with explicit counts for connections outside the view.
  Inspection preserves unresolved Agent selection, normalizes Flow selectors, checks project compatibility, and identifies each Binding's implementing package.
- e63b8e9: Support native Apple Silicon macOS 15+ through required process identity,
  coalition accounting and sandbox capabilities instead of exact OS build pins.
  Record each host's observed identity and fail closed when enforcement is unavailable.
  Retire Intel macOS support while requiring genuine native ARM Codex session
  creation, containment and cleanup on macOS 15 and 26. Preserve fresh bounded
  preference-policy observation and refuse unavailable or configured forced policy.
- bfa09cd: Replace the Codex ACP v1 compatibility adapter with upstream native ACP v2.
  Preserve private subscription bootstrap, finite inference, cancellation,
  native failure diagnostics, and truthful shutdown results. Remove Jig's direct
  ACP v1 SDK dependency. Rebuild the canonical archives affected by the patch.
- 74981e7: Remove the legacy Pi ACP v1 compatibility bridge rather than preserving protocol
  translation in Jig's native Agent support. Only qualified direct ACP v2
  implementations are eligible as Codex or Claude Code clients. Pi requires a
  native ACP v2 adapter and independent conformance before admission can return.

### Patch Changes

- c8ded9d: Explain settled child artifact failures with safe step and reason diagnostics while preserving file rejection, cleanup precedence and retained checkpoints.
- 2aaf262: Add `jig inspect --flow --all` to inspect every configured target and connection, including targets disconnected from the default entrypoint.

## 0.1.0-alpha.54

### Patch Changes

- bb06f97: Upgrade Jig's bundled Claude Agent ACP bridge to the direct ACP v2
  implementation and align its Claude SDK with the supported upstream release.
  Preserve finite task authority by reapplying unattended title-generation
  suppression to the new adapter distribution.
  
  Requalify the canonical archives of the other published workspace packages,
  which share the top-level patched dependency and therefore participate in the
  same reproducible release-candidate construction.

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

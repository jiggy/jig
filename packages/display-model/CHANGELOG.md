# @jigging/display-model

## 0.1.0-alpha.12

### Minor Changes

- 2198be7: Add reviewed offline tool slots for exact binary input and output within a Run.
  The Linux candidate verifies an operator-provisioned Nix runtime and uses
  Jig's existing resource, cancellation and artifact custody rules.

## 0.1.0-alpha.11

### Minor Changes

- 1d5d13a: Open a comparison of two saved Run packets in the local browser inspector with `jig inspect --result EARLIER --compare LATER --display web`.
- 3251352: Compare two saved Run packets with `jig inspect --result EARLIER --compare LATER`. Reopen the recorded call paths after the Runs exit and see differences, matches, and gaps in observation.
- 9b5bed9: Reload the last accepted input and compatible uploads after reviewing a new approval. Compare retained call paths, targets, outcomes, and counts for the last two Explorer Runs.
- bbe2243: Show late changes first in Explorer's comparison of two settled Runs when the retained call trees fit the current settlement allowance.
- 8abb2d0: Prioritize nonmatching paths in browser comparisons of saved Runs, retaining full counts on every displayed path.

### Patch Changes

- 2b67583: Save bounded child call evidence with `jig run --record-calls --out DIR`. Reopen and verify it with `jig inspect --result DIR --calls`.

## 0.1.0-alpha.10

### Patch Changes

- 727abeb: Show possible behavior from approved source in the explorer and the Run's Application map. Show returned call outcomes, reported progress, and verified file names with the selected Run.
- cfa4578: Choose input files for a workflow in the browser explorer. Reuse the same files across approved workflows and compare the last two Runs.

## 0.1.0-alpha.9

### Patch Changes

- bfa09cd: Replace the Codex ACP v1 compatibility adapter with upstream native ACP v2.
  Preserve private subscription bootstrap, finite inference, cancellation,
  native failure diagnostics, and truthful shutdown results. Remove Jig's direct
  ACP v1 SDK dependency. Rebuild the canonical archives affected by the patch.
- 74981e7: Remove the legacy Pi ACP v1 compatibility bridge rather than preserving protocol
  translation in Jig's native Agent support. Only qualified direct ACP v2
  implementations are eligible as Codex or Claude Code clients. Pi requires a
  native ACP v2 adapter and independent conformance before admission can return.
- Updated dependencies [bfa09cd]
- Updated dependencies [74981e7]
  - @jigging/reporting@0.1.0-alpha.7

## 0.1.0-alpha.8

### Patch Changes

- bb06f97: Upgrade Jig's bundled Claude Agent ACP bridge to the direct ACP v2
  implementation and align its Claude SDK with the supported upstream release.
  Preserve finite task authority by reapplying unattended title-generation
  suppression to the new adapter distribution.
  
  Requalify the canonical archives of the other published workspace packages,
  which share the top-level patched dependency and therefore participate in the
  same reproducible release-candidate construction.
- Updated dependencies [bb06f97]
  - @jigging/reporting@0.1.0-alpha.6

## 0.1.0-alpha.7

### Patch Changes

- 624cd30: Requalify shared workspace build inputs after the root dependency patch policy
  now pins Claude Agent ACP 0.101.0 with Jig's nonessential-title-inference
  safeguard. No unrelated application behavior was intentionally changed. The
  root patched-dependency policy participates in each package's reviewed build.
- cebde11: Prevent quoted syntax-highlight tokens from consuming subsequent source lines.
- 90f684e: Qualify Linux and macOS runtimes to Bun 1.4.4 revision 38afee6c84fcf48c0edb2466aa4b27d287a59c30 and enforce pure evaluation in shell.nix.
- Updated dependencies [624cd30]
- Updated dependencies [90f684e]
  - @jigging/reporting@0.1.0-alpha.5

## 0.1.0-alpha.6

### Patch Changes

- c25d356: Explore approved workflows before execution, inspect their configured connections and input contracts, and launch ordinary Runs with explicit JSON input.
  Keep project control separate from Run observation, with exact approval checks, bounded requests, and ordinary cancellation and cleanup.
- f1425ce: Add a read-only application map to live browser inspection.
  Show the exact admitted components and available child calls beside observed invocations.
  Component selection opens matched call evidence without changing application-owned landing pages.
  Preserve distinct Bindings, missing observations, and bounded composition limits.

## 0.1.0-alpha.5

### Patch Changes

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
- Updated dependencies [760d855]
- Updated dependencies [3b95d1b]
- Updated dependencies [7effb0f]
  - @jigging/reporting@0.1.0-alpha.4

## 0.1.0-alpha.4

### Patch Changes

- f277e9a: Clarify the bundled license map for the new Jig homepage and its separately licensed fonts.

## 0.1.0-alpha.3

### Patch Changes

- ecaa82e: Add application view targets, gallery roles, formatted reports, captured media,
  and explicit bounded collection previews. Coalesce whole live snapshots within
  publication epochs and expose matching TypeScript and Python authoring helpers.
  
  Retain explicitly selected final display bundles as atomic application editions.
  Add revision checks, original receipt recovery, exact captured evidence, and
  read-only CLI and web inspection. Keep retained presentation independent of Run
  execution and application freshness.
  
  Select the exact Apple Silicon Darwin 24.6.0 build 24H232 profile. Bind hosted
  qualification to each architecture's selected kernel, build, and native runtime.
- Updated dependencies [ecaa82e]
  - @jigging/reporting@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- 1f7d155: Generate independent alpha versions and dependent pins from reviewed release notes.
  Preserve qualification-only status for reporting and display artifacts.
- Updated dependencies [1f7d155]
  - @jigging/reporting@0.1.0-alpha.2

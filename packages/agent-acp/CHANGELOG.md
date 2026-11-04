# @jigging/agent-acp

## 0.1.0-alpha.13

### Minor Changes

- 9089b55: Preserve refusal and limit outcomes with their original text when structured
  output cannot be decoded or does not match the requested response schema.
  Include structured data only when it validates, without promoting a partial
  answer to completion. Completed answers and independently supplied structured
  results remain strict.

### Patch Changes

- 760d855: Route documentation links to the task-focused Jig guides. Preserve the documentation license coverage after moving explanatory pages.
  
  Retain bounded private package-verification causes during qualification. Correct the existing stale-plan exit expectation after successful cleanup.
  
  Select Bun 1.3.3 for Linux qualification and execution while retaining the qualified Mac runtime.
- 3b95d1b: Build Linux candidates with Bun 1.3.13, preserve Jig's authoring exports, and use its pinned runtime. Explain unsupported registry sources in dependency locks with actionable repair steps.
  
  Allow standalone Flows to ignore unrelated ancestor workspaces.

## 0.1.0-alpha.12

### Patch Changes

- 1f7d155: Generate independent alpha versions and dependent pins from reviewed release notes.
  Preserve qualification-only status for reporting and display artifacts.

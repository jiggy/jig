# @jigging/agent-acp

## 0.1.0-alpha.14

### Patch Changes

- 624cd30: Upgrade the ACP agent transport and Jig finite ACP host to ACP v2 only, removing v1 protocol compatibility. Support insertion acknowledgement, agent-owned message identifiers, content upsert handling, terminal foreground state, required session close, and updated Codex, Claude, and Pi ACP adapters.
  Deliver native candidate recovery across optional `backup1`–`backup3` slots with `uses.<slot>.optional`, host-attested `not-forwarded` and `rejected-without-output` failure boundaries, confirmed pre-dispatch failure metadata, and confirmed cleanup. Preserve Codex session continuity across compatible same-client authentication profiles with atomic pre-acceptance release.
- 90f684e: Qualify Linux and macOS runtimes to Bun 1.4.4 revision 38afee6c84fcf48c0edb2466aa4b27d287a59c30 and enforce pure evaluation in shell.nix.

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

# Preserve Pi failures across ACP

Companion: [pi-acp@0.0.33.patch](pi-acp@0.0.33.patch).
Applies to the published `pi-acp` **0.0.33** adapter's `dist/index.js` through
the root `package.json` `patchedDependencies` entry. Normal Bun installation
applies it before Jig bundles the adapter; generated `libexec` is not edited.

## Why it is needed

The adapter can return ACP `end_turn` after Pi reports an assistant failure.
It also lets `agent_settled` race a rejected prompt RPC and manufacture success.
Successful command acceptance, settled execution, and a successful Agent answer
are different facts; Jig must preserve that distinction.

Jig's adapter invokes its private Pi launcher with the current verified Bun
runtime explicitly. Its script interpreter must not depend on a Linux mount
path or ambient executable discovery on macOS. The launcher then starts the
reviewed native Pi executable with the existing constrained arguments.

The patch waits for prompt acceptance before handling successful settlement,
tracks the final assistant's authoritative stop reason, and preserves errors,
cancellation and token exhaustion. An error becomes a generic JSON-RPC internal
error without disclosing provider details. Empty successful output remains
valid; an earlier recovered error does not invalidate a later successful answer.

The original defect was reproduced with Pi 0.84.4 under Node 24.11.1 against
a local HTTP 503 fixture: unpatched ACP returned `end_turn`; patched ACP
returned error `-32603`. This is adapter evidence, not qualification of every
Pi installation or Jig containment profile.

## Upstream tracking

- [Issue #98](https://github.com/svkozak/pi-acp/issues/98) tracks prompt RPC
  failures and exhausted retries being reported as clean `end_turn`.
- [Issue #92](https://github.com/svkozak/pi-acp/issues/92) tracks missing
  provider/billing failure information.
- [PR #104](https://github.com/svkozak/pi-acp/pull/104) addresses those reports,
  but its described approach emits failure text while retaining `end_turn`.
  That alone does not satisfy Jig's removal condition: the request's result
  must distinguish failure from a valid empty answer.

## Verification

From the repository root after normal dependency installation:

```sh
bun test packages/jig/test/pi-acp-failure.test.ts packages/jig/test/pi-agent-provider.test.ts
```

The first suite exercises the installed vendor adapter with a deterministic Pi
RPC peer. It covers rejected prompts, rejection racing settlement, partial-output
failure, empty success, recovered errors, cancellation and token limits. The
second checks Jig's reviewed Pi installation and launch policy.

## When to remove it

Remove the patch when a selected unpatched upstream adapter passes these
behavioral regressions, including the prompt-acceptance race, and a bounded
real-Pi failure check confirms that provider failure cannot become ACP success.
A newer version or a patch that no longer applies is not sufficient evidence.

In the same change, update the pinned dependency, remove the root
`patchedDependencies` entry and both companion files, update the third-party
notice, rebuild the adapter through the normal build, and verify the affected
installed native path. Keep the behavioral regressions: they protect the
contract, not the existence of this patch. If the Pi integration itself is
removed, remove its now-unowned patch, note and tests together.

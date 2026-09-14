# Disable implicit Codex title-generation turns

Companion: [codex-acp@1.8.0.patch](codex-acp@1.8.0.patch).
The root Bun `patchedDependencies` applies this to the pinned ACP adapter
before the ordinary Jig build. Generated `libexec` is not edited.

## Why it is needed

After completing a requested prompt, this adapter starts an unrequested
ephemeral thread to generate a title using a hardcoded model. The native
resource's reviewed prompt limit must not hide a second model operation.
The patch removes that automatic dispatch hook. The existing deterministic
title derived from the first prompt remains; no replacement model call occurs.

This is a source-confirmed automatic dispatch path, not evidence of how many
historical remote title requests completed. No exact upstream issue or fix is
established here.

## Verification

`bun test packages/jig/test/codex-acp-dispatch.test.ts` launches the actual
installed adapter against a bounded recording app-server peer. Successful
completion and rejected turns each issue exactly one model turn, with the
selected model, and no ephemeral title thread. The peer accepts unexpected
threads so it does not accidentally hide the defect. This is adapter behavior,
not proof about native Codex's internal network retries or compaction.

## Removal condition

Remove both files and the manifest entry when the selected upstream adapter
provides a verified no-implicit-model-work configuration (or removes this
behavior). Keep the behavioral dispatch regression, rebuild the installed
adapter, and qualify the same bounded native conversation path. A version bump
or a patch conflict alone does not establish the removal condition.

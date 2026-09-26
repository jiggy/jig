# Keep Codex dispatch, interruption and shutdown accountable

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

The adapter also discarded the native child's exit status and kept an
unconditional two-second shutdown timer alive after clean exit. Its `killed`
flag described signal delivery, not process completion. The patch preserves
native nonzero exit, signals and launch errors as adapter failure, clears the
timer on actual close, and records forced termination as failure even if the
native signal handler exits zero. It never truncates output with an immediate
adapter exit. Jig's existing grace period and tree fencing remain unchanged.

The adapter registered a pending turn only after asynchronous prompt setup.
An immediately following `session/cancel` could see neither a current turn nor
a pending turn and disappear, leaving the follow-up running until host fencing.
The patch registers the pending turn before that setup. Cancellation waits for
the native turn ID and targets it; the native completion still supplies the
cancelled result. No early synthetic completion or longer timeout is introduced.

## Verification

`bun test packages/jig/test/codex-acp-dispatch.test.ts` launches the actual
installed adapter against a bounded recording app-server peer. Successful
completion and rejected turns each issue exactly one model turn, with the
selected model, and no ephemeral title thread. The peer accepts unexpected
threads so it does not accidentally hide the defect. This is adapter behavior,
not proof about native Codex's internal network retries or compaction.
The same recording peer covers clean EOF, nonzero exit, signal termination,
and ignored EOF followed by a forced zero exit. Clean shutdown does not wait
for the obsolete timer. This is not a persisted-session or clean-state receipt;
native state collection and restoration need their own qualified boundary.
An immediate-follow-up case sends prompt and cancellation together and delays
the native turn-start reply. It requires an interrupt naming the second turn,
the actual cancelled response and clean shutdown. The unpatched race times out;
the correction settles normally.

## Removal condition

Remove both files and the manifest entry when the selected upstream adapter
provides verified no-implicit-model-work behavior, immediate interruption and
truthful bounded child shutdown. Individual hunks may be removed when their own
upstream correction is verified. Keep the behavioral dispatch, interruption and
shutdown regressions, rebuild the installed
adapter, and qualify the same bounded native conversation path. A version bump
or a patch conflict alone does not establish the removal condition.

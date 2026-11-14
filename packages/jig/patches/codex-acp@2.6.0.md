# Codex ACP 2.6.0 — Jig authority patches

The pinned upstream adapter is a native ACP v2 implementation. Jig does not
modify protocol negotiation, method schemas, or v1 compatibility.

Two independent host-authority properties remain local, until upstream
supports them natively.

1. A subscription credential is projected through Jig's trusted launcher
   over a private startup descriptor. The adapter consumes the one-shot
   in-memory `__JIG_CODEX_AUTH_BOOTSTRAP__` before completing app-server
   initialization, using the native `chatgptAuthTokens` login. No credential
   is placed in a reusable environment variable, client-visible ACP request,
   or persistent file. Failure stops initialization.
2. Upstream's `TitleGenerator.onTurnCompleted` starts a separate ephemeral
   model invocation with a hardcoded model. The finite Jig grant authorizes
   only its reviewed task turns. The patch disables that unsolicited model
   operation; explicit prompt-derived display text remains the host's job.

The source-level ACP v1 translation patch used for earlier Codex releases
is not retained. The repository's dispatch, cancellation, failed-result,
credential-isolation and process-cleanup regressions remain the acceptance
tests for this exact upstream version. A published version bump alone is
not evidence of those properties.

To remove these final two hunks, establish an upstream implementation
that passes all credential isolation and finite model-dispatch checks,
including native host conformance. Do not remove them merely because
another ACP client implements v2.

# Claude Agent ACP 0.101.0 security patch

The upstream Claude Agent ACP adapter has an optional `SessionTitles`
feature. When the Claude SDK exposes `generateSessionTitle`, the adapter
may invoke an additional model after queuing a prompt or finishing a turn.
Its documentation explicitly says this can happen even when
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` prevents the underlying CLI's
own title generation.

Jig's finite native ACP grant authorizes only the reviewed task prompts and
does not authorize an independent, unreviewed small-model request to title
the conversation. Jig's Claude provider always sets
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and
`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`. This small source-distribution
patch makes the adapter's `supportsTitleGeneration` guard respect the same
nonessential-traffic restriction, so both the prompt-time and idle-time title
paths decline to create extra inference work.

No runtime monkeypatch, client-visible option, or additional provider authority
is introduced. The patch is version-pinned, applied by Bun, and checked by
portable source tests; upgrading the upstream adapter must requalify this guard.

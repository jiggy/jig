# Claude Agent ACP 0.107.0 security patch

The current upstream adapter uses a direct ACP v2 agent, but its optional
`SessionTitles` feature still requests `generateSessionTitle` separately
when the SDK supports it. With Claude's own nonessential traffic disabled,
that request can create a **new model invocation** outside Jig's finite
grant and task prompt accounting.

Jig's Claude provider always sets
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and
`CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1`. This targeted distribution patch
makes `supportsTitleGeneration` respect the same restriction, covering
both prompt-time and idle-time title requests without changing the adapter's
ACP v2 protocol behavior.

The patch is version-pinned in the workspace, applied during dependency
installation, and checked against the installed published distribution by
portable source tests. The next adapter upgrade must requalify this guard.

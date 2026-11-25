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
both prompt-time and idle-time title requests.

The adapter also emits `_auth/status_update` and `auth/status_update` during
startup. Jig selects and projects credentials before launch. These unsolicited
identity notifications are outside its finite ACP exchange and can cause the
host to fence the client before the task prompt. When nonessential traffic is
disabled, the patch keeps the reporter's internal authentication state and
suppresses both wire notifications. The ordinary ACP v2 handshake and session
configuration remain required.

The patch is version-pinned in the workspace, applied during dependency
installation, and checked against the installed published distribution by
portable source tests. An adapter upgrade can remove these hunks when its
bundled configuration suppresses separate title inference and unsolicited
authentication-status notices and passes the corresponding qualification.

For grants with an explicit reasoning effort, the adapter requires the current
SDK query to acknowledge the pin again before it queues each prompt. A restart
must restore that pin on the replacement query before dispatch.

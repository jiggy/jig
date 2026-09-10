# live-agent-chat

Input supplies `instructions` and optional `suppress: true`. Make one Agent
call with its named public-update channel. Display assistant text fragments as
they arrive; plan updates are not displayed. When the caller connects the
`progress` output, publish there instead of printing duplicate diagnostics.

Output keeps the actual Agent result and a separate progress-completeness
record. Suppression affects only progress, not the returned answer. Failed
observation does not establish Agent failure, and channel completion does not
establish Agent success. Cancellation never authorizes another call.

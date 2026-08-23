# Expected GUI failure walkthroughs

## Duplicate HTTP submission

The browser retains its submission ID until acknowledgement. Same ID and same
Binding/input returns the original Run. Same ID with changed content returns
`SUBMISSION_CONFLICT` and starts nothing.

## Cancellation

Repeated cancellation with the same cancellation ID joins one request.
Acceptance means cancellation was requested, not that the Run is already
terminal. The browser continues polling. An external effect may remain
`UNCERTAIN`; the UI must not relabel it cancelled.

## Browser or application crash

Browser loss has no effect on Runs. Application-server loss closes only its
control client and listener. A restarted server can inspect retained Run IDs
and Journal positions. It cannot recreate a browser's unpersisted local cursor.

## Event compaction

If `after` precedes the minimum retained position, the control API returns an
explicit cursor-expired failure with that minimum. The application refreshes
current state through ordinary Runs. It never claims complete Event replay.

## Authority

The browser cannot call Jig directly. A forged Binding ID is still filtered by
the server's route allowlist, and Jig independently admits only active Run
Bindings. The control client cannot invoke Service methods, append Events, or
apply project policy.


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
project client and listener. A restarted server can inspect retained Run IDs.

## Authority

The browser cannot call Jig directly. A forged Binding ID is still filtered by
the server's route allowlist, and Jig independently admits only active Run
Bindings. The application API exposes no Service invocation, Event append, or
policy application route. Strong isolation of same-user application code
remains a host deployment concern, not a JavaScript authority object.

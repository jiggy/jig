# Candidate Jig frontend operations

**Status:** post-freeze design candidate, not a reviewed Jig/1 specification.

The GUI probe established one stable boundary and two plausible additions:

```text
stable       startRun(bindingId, input, submissionId)
candidate    getRun(runId)
candidate    cancelRun(runId, cancellationId)
```

CLI, GUI, and trusted local application code must enter the existing root Run
admission path. A frontend cannot name raw package source, supply per-Run
settings, remap attachments, choose providers or runtimes, or widen authority.

`getRun` is likely needed to observe an asynchronously submitted Run.
`cancelRun` is likely needed to request idempotent cancellation. The exact
transport, authentication, project-opening API, visibility rules, snapshot
shape, and package spelling remain unreviewed. In particular, the discarded
`@jig/client` probe let a caller submit its own authority object, which is not a
security boundary.

The simple GUI probe did **not** establish a need for a host Event reader,
subscription, stream, daemon protocol, browser SDK, or portable Journal query.
Those surfaces require separate evidence.

Until this seam is reviewed, pseudocode may use `openProject` from
`@jigging/jig` only as an explicit candidate spelling. It must not be cited as
Jig/1 conformance.

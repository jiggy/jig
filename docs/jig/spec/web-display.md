# Local web display

This contract governs `jig run --display web` and
`jig inspect --result DIRECTORY --display web`. The
[CLI experience](cli-experience.md) owns command grammar, exact output and
information hierarchy; [user updates](user-updates.md) owns portable authored
meaning. Browser transport is a private host adapter, not a Flow API.

## Scope and admission

One invoking CLI owns one read-only browser inspector for its finite Run or
selected saved packet. The inspector renders the same validated semantic
reports, facts, measured progress, collections, details and references as the
terminal. Authors cannot supply browser components, HTML, CSS, scripts or
execution-changing callbacks. Jig supplies actual observed call relationships,
diagnostics, authenticated evidence access and lifetime. The independent
`@jigging/display-web` package owns the browser client, rendering, local navigation
and fixed assets; it consumes `@jigging/display-model` snapshots without importing
Jig. Its bounded display interface grants no HTTP server or execution authority.

The display requires terminal stderr; stdin need not be a terminal. JSON and
explicit channel reception win before server preparation. Run stdout may be
redirected and still receives its unchanged exact final result. Saved inspection
with redirected stdout or `--json` emits exact decoded JSON without a listener.
`--updates off` suppresses automatic optional-port reception; it does not hide
host facts, calls, diagnostics or delivered files. A web request cannot enable
channels or change the Run's input, deadline or policy.

Prepare bundled assets and an unadvertised loopback listener before execution.
Publish the private browser link only after trusted root dispatch, synchronous
subscription and an encoded initial snapshot that can immediately be read.
Invalid arguments, input, review, installation, file or output prerequisites
remain ordinary actionable diagnostics without browser activation. Valid saved
inspection activates after decoding and completed bounded capture; a valid
report with partially unavailable files may open with explicit findings. Invalid
reports do not open a dashboard. Browser opening is the operator's choice.

## Local access boundary

Bind explicitly to numeric IPv4 loopback on an ephemeral port. No LAN interface,
remote host, resident daemon, multiple Runs, browser approval, apply, retry or
Run cancellation control is provided. The browser may explicitly close
presentation, but cannot alter execution.

A cryptographically unpredictable, session-specific capability authorizes every
snapshot, stream, artifact and close request. The launch fragment bootstraps
memory-only browser authorization and is removed from visible history before
requests. Never put it in a query, cookie, local/session storage, result packet,
model journal, diagnostics or access logs. Reload requires reopening the
original terminal link in a new tab and does not submit work again. Possession of that link
permits reading this session and closing its inspector; sharing it delegates
that presentation access.

Validate the parser-visible Host and canonical request origin against the exact
numeric listener authority, without hostname aliases or forwarded-header
substitution. Present Origin must match exactly; close requires explicit exact
Origin. Present fetch-site metadata must be same-origin. No permissive CORS,
preflight exception or authentication fallback exists. Duplicate Host values,
malformed routes, queries, uploaded bodies and unknown artifacts fail closed.
Native parsing can normalize request targets before the handler sees them;
these checks do not claim to inspect the original request line.

Serve only fixed bundled host assets and authenticated observation endpoints.
Use a restrictive same-origin content-security policy without inline/evaluated
scripts, external fonts, CDN resources or analytics. Render authored titles,
reports, diagnostics, filenames and bytes as inert literal text, including HTML,
SVG, Markdown HTML and bidirectional controls. Literal words cannot impersonate
host status, authority, commands or application success. Errors contain bounded
closed causes, not private stack traces or execution arguments.

Application counters limit work after native parsing. They do not enforce a
hard process quota on native headers, ingress buffers, sockets or copies before
the handler. Local traffic can exhaust availability or lose the CLI coordinator;
independent execution fencing and normal cleanup remain required. Loopback alone
is not authentication and the capability does not defend against a compromised
operator account, browser or trusted host runtime.

## Observation, revisions and bounds

The browser consumes explicit semantic snapshots, never a serialized model
instance, private authority record, callback, Map or terminal-escaped frame.
Accepted-send participant identity supplies attribution. Host call identities
are scoped by actual publisher and own operation identity; labels, reported
paths and arrival order cannot join sources. An omitted parent/own call remains
unavailable or incompletely observed. Recorded packet values are local claims,
including fields resembling host facts.

Captured stderr is a host observation with unknown importance. When the actual
execution owner supplies its emitter and original caller identity, preserve the
opaque source and call association. A diagnostic path is descriptive text and
cannot supply that association; missing sideband or omitted calls stay unknown.

Host input filenames, attachment roots, output destinations and the selected
saved directory are terminal-only invocation settings, not browser observation
fields. Saved browser inspection uses a fixed packet label. Literal application
reports and recorded values may contain authored paths; they remain inert claims
and cannot grant file access.

Publish atomic full view replacements, retirement, ended context, omissions,
known causes and unknown states. An application count, returned call, report or
100% progress never certifies host or domain success. Display execution,
application outcome, cleanup, delivery and observation completeness separately.
All retained causes remain reachable from every view; diagnostic importance
absent structured classification remains unknown.

Each monotonically increasing advertised revision names an already committed,
readable encoded snapshot. Subscribe before initial capture without a lost-update
gap. Coalesce superseded snapshots at at most five productions per second;
initial and final settlement capture may bypass pacing. One-way notifications
name revisions, not a replay log. Reconnect reads the latest snapshot and never
resubmits execution. Equal current revisions can restore transport freshness;
they cannot make an incomplete semantic body complete.

The observation model retains the existing profile limits: 32 views /512 KiB
per command, 8 views /128 KiB per publisher, 16 activities, 256 actual call nodes
at depth 32 /256 KiB metadata, and bounded journals/attention. Encoded complete
snapshots are at most 8 MiB. Projection/encoding failure supplies an independently
bounded 2 MiB incomplete envelope with current facts, every retained cause,
bounded diagnostics, omissions and a closed explanation. It must not prune a
failed body heuristically or expose an exception. A previous complete browser
body may remain visibly stale with its references disabled. Failure of the
reserve closes presentation and emits an essential ordinary diagnostic.

Admit at most four stream clients and eight ordinary requests, including at
most two snapshot responses and one preview supplier. No waiting request queue
is created. Each stream keeps one superseding revision notification, events at
most 512 bytes and at most 1 KiB of queued application stream data. Heartbeats
occur every twenty seconds; thirty seconds of blocked writes initiates native
cancellation of only that connection. The native idle timer has coarse
granularity; retain the admission until cancellation is acknowledged rather
than admitting uncounted draining connections. Keep encoded response generations and pending writes bounded.
Native copies are an explicitly separate availability limit.

A browser retains independent local selection, sorting, filtering, disclosure,
scroll and preview intent. Tabs cannot move each other's focus or the terminal's.
Bound client fetching to one snapshot task, highest notified revision, one retry
timer and one preview task. Capacity responses have bounded backoff; reconnect
storms, stale asynchronous completions and close cannot build a queue or restore
disposed presentation. A newer file intent must never receive older bytes beneath
its title.

## Evidence and presentation

Artifact endpoints accept only an opaque retained capture identity. They never
accept absolute paths, enumerate project directories, reopen mutable destination
paths, follow recorded destinations or perform network requests. Only verified
manifest-selected immutable captures supply bytes. Root authored references
require the accepted root source, declared output attachment and verified path.
Child-only declarations remain unavailable until the parent delivers/remaps
actual evidence. The independent host file inventory does not attribute its
bytes to an unavailable authored reference.

Capture retains at most 64 files /16 MiB under the existing confined file policy.
Live settled inspection transfers at most 64 text excerpts /4 MiB, each at most
64 KiB. One active browser preview is bounded to one such UTF-8 excerpt. Empty,
non-text, unavailable and clipped evidence are distinct states. Content is primary;
path, byte count, verified-delivery/recorded-capture provenance and limits are
secondary. Preserve diff whitespace with addition/removal/context roles and a
plain fallback. Expansion adds space, scrolling and search of retained text.

Provide a compact host shell, visible focus, keyboard and pointer navigation,
responsive layouts, readable selected context, view overflow navigation and
text selection. All report/fact/progress/collection blocks remain reachable.
Wide navigation separates host inspection from attributed application views.
Routine snapshot replacement uses a stable quiet synchronization indicator,
while actual disconnection and incomplete observation remain explicit. References
remain disabled until a current complete snapshot is acknowledged.
Activity folds completed startup ceremony into history; Execution follows actual
calls rather than inferring domain tasks. Domain views supply their goals and
verification explanations. Color supplements explicit wording and must remain
usable in light, dark, color-free and narrow presentations.

The browser execution tree may show intervals from each call's first to latest
actual host observation on a common scale. These are observation spans, including
requested time when observed; they are not measured execution durations. Active
bars end at the latest observed transition, without interpolating unseen work.
Unknown or inconsistent clock evidence has no fabricated span. Filtering retains
actual ancestors of matching calls. Call details may include retained reports
associated by accepted-source or host-observed correspondence, never by matching
names or diagnostic path strings.

Saved packets contain no retained portable views or invocation history. Render
only fixed recorded fields, captured files and recorded diagnostics, without
reconstructing domain views or a graph from prose or familiar keys. Manifest
consistency is not authentication of the report.
Saved navigation provides one Recorded result, Captured files and Diagnostics
surface. It shows no synthetic activity history or elapsed-run claim. Private
host adapter roles distinguish these surfaces; authored IDs/titles never select
host navigation. File-capture findings remain visible alongside the inventory.

## Lifetime and failure

Browser disconnection, tab unload, client count and silence neither cancel work
nor close the inspector. The global Close inspection action closes all viewer
connections and releases presentation only; live work continues in ordinary
output. Optional terminal q/Escape closes presentation when raw input is actually
owned. Keyboard Ctrl-C cancels live work through the existing cancellation owner;
after settlement it closes presentation only. Piped stdin remains untouched.
External OS signals retain normal interruption semantics.

There is no inspector idle/countdown/absolute timeout. An explicit inherited
command constraint remains authoritative and cannot be renewed by interaction.
Effective web with terminal stderr omits the default outer command envelope,
independently of stdin and styling; setup, execution and cleanup limits remain.
Elapsed execution time freezes at settlement.

Before indefinite Run inspection, complete project/execution cleanup and spend
file/checkpoint/native delivery authority irreversibly. One total twenty-second
completion allowance, narrowed by an inherited presentation constraint, covers
preview transfer and authenticated retirement; ordinary previews use at most its
first ten seconds, reserving retirement time. Include no-publication/no-preview
paths. Fence every verb and recovery fallback before closing resources. Accept
success only after resources close, authenticated retirement acknowledgment and
expected spent-channel completion. Release local input/output captures before
waiting on the inspector. Retain only bounded semantic presentation and pure
captured excerpts; no project lock, execution scope, channel owner, descriptor
endpoint or native renderer remains alive for browser inspection.

Late/lost/silent acknowledgments, uncertain closes and exhausted completion
allowances close presentation finitely. Preserve any known execution and delivery
result, report separate command-cleanup failure and exit 2; do not replace a known
terminal with an invented unknown one. Shutdown closes active streams, timers,
subscriptions and retained buffers even with abandoned readers. Display failure
may fall back to ordinary presentation without canceling domain work; genuine
command output loss retains the existing cancellation policy.

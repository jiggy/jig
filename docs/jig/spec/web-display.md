# Local web display

This contract governs `jig explore`, `jig run --display web`,
`jig inspect --result DIRECTORY --display web`, and `jig views --display web`. The
[CLI experience](cli-experience.md) owns command grammar, exact output and
information hierarchy.
[Reporting](reporting.md) owns portable authored meaning. Browser transport is a private host adapter, not a Flow API.

## Run inspection and admission

One invoking CLI owns one read-only browser inspector for its finite Run or
selected saved packet or retained application views. The inspector renders the same validated semantic
reports, facts, measured progress, collections, details and references as the
terminal. Authors cannot supply browser components, HTML, CSS, scripts or
execution-changing callbacks.

Jig supplies actual observed call relationships,
diagnostics, authenticated evidence access and lifetime. The independent
`@jigging/display-web` package owns the browser client, rendering, local navigation
and fixed assets.
It consumes `@jigging/display-model` snapshots without importing Jig. Its bounded display interface grants no HTTP server or execution authority.

Root-publisher application pages precede an Inspector group containing
Execution, Activity, delivered files and attributed child views. Sections
compose an authored page: reports, facts and progress appear together, and
collections show every column in a horizontally scrollable table or an explicit gallery. Filtering,
sorting, stable selection, full record details and typed evidence navigation
remain available. Details open on request rather than occupying the initial
application screen.

A compact top bar shows application and page names, with routine host facts available through Run details.
Attention and observation loss remain visible across pages, alongside an explicit Close action.

Application instance labels populate the scope selector without inventing records.
Document presentations show captured covers, chapter outlines, body photographs and verified downloads.

Directly invoking a child makes that invocation the root. Its own view becomes
primary. Recorded-packet navigation retains its explicit host roles.
[Retained application views](display-archive.md) show only their selected projections and captured evidence.
They invent no execution tree, activity history or duration.

An empty archive or unmatched filter remains a valid inspector.
Show an explicit empty state without synthetic destinations.
Keep Diagnostics, Help and Close available.
Only an existing selected tab labels a tabpanel.

The display requires terminal stderr. Stdin need not be a terminal. JSON and
explicit channel reception win before server preparation. Run stdout may be
redirected and still receives its unchanged exact final result. Saved inspection
with redirected stdout or `--json` emits exact decoded JSON without a listener.

`--updates off` suppresses automatic optional-port reception. It does not hide
host facts, calls, diagnostics or delivered files.

A Run inspector request cannot enable channels or change the Run's input, deadline or policy.

Prepare bundled assets and an unadvertised loopback listener before execution.
Publish the private browser link only after trusted root dispatch, synchronous
subscription and an encoded initial snapshot that can immediately be read.
Invalid arguments, input, review, installation, file or output prerequisites
remain ordinary actionable diagnostics without browser activation. Valid saved
inspection activates after decoding and completed bounded capture; a valid
report with partially unavailable files may open with explicit findings. Invalid
reports do not open a dashboard. Browser opening is the operator's choice.

Appearance is viewer-local. Icon buttons select System (monitor), Light (sun),
Dark (moon), or Monochrome. System is initially selected and follows the browser's
color preference. Each button has an accessible name, tooltip, visible focus and
pressed state; selection requires no Flow declarations, storage or new endpoint.

## Project exploration before execution

`jig explore [target]` opens an operator-owned project session before any Run.
It presents approved workflows, their configured composition, and each selected workflow's declared input contract.
Opening, selecting, refreshing, and editing an input draft do not start work.
An unreviewed project has an explicit empty state with `jig review` guidance.
The browser cannot review, apply, edit source, or change grants.

Exploration reads a consistent protected approval snapshot without evaluating source, preparing dependencies, acquiring a coordinator, or recovering state.
It retains no protected read transaction while idle.
The selected schema preserves its contract definitions.
Private settings, grant values, selectors, paths, and approval records stay outside browser data.
Opaque revision and target identifiers bind selection without granting authority themselves.

Configured maps contain no synthetic Run, request count, duration, success, or skipped-step claim.
Connections retain their meaning as available calls.
The interface labels configuration separately from observations after execution.
Flow and Binding targets remain independently selectable.

The complete project projection allows 4,096 targets and 16 MiB of encoded JSON.
A selected input schema and its definitions share 256 KiB.
Composition retains its existing component, connection, and byte allowances.
Oversized composition is unavailable as a whole.
Other projection overflow refuses that projection without dropping workflow or input requirements.

The operator supplies explicit JSON input, including valid scalar values.
The editor must not invent required values or silently remove duplicate object members.
One launch envelope, including its selection and request identity, allows 16 MiB.
Ordinary JSON and invocation-schema validation still apply before execution.
Required unbound input files and required channels make browser launch unavailable, with an explanation and the ordinary invocation path.
Reviewed file bindings and ordinary automatic output delivery retain their existing behavior.

Run is an explicit action under a separate project control capability.
The host rechecks the selected approval and target immediately before the ordinary Run path.
Changed approval requires refresh and renewed selection.
Each launch has a fresh ordinary command, containment, output owner, and cleanup lifecycle.
The explorer permits one owned invocation at a time, including its preparation.
It never resets spent delivery authority or transfers a previous Run's grants.

The client submits a launch once, then reads status to resolve an ambiguous response.
Duplicate request identities cannot launch another invocation.
Reconnection and refresh never submit work.
Uncertain execution prevents another launch within that session.
Settled execution remains distinct from application success.

The global Run status controls launch availability.
A separate request lookup reads the retained result for one submitted identity, including a busy refusal.
An absent identity remains unknown and cannot establish that execution did not start.
The explorer retains at most 128 request identities, without evicting earlier identities to permit replay.

The explorer preserves the input draft and exposes an explicit link to the ordinary Run inspector.
That inspector receives its own observation capability on its own loopback listener.
It receives no project control capability.
Closing a settled inspector before the next launch releases its command owner.
Earlier run history is not an explorer archive.

Close explorer prevents new launches and cancels active owned work through ordinary cancellation and cleanup.
It waits for owned command settlement before releasing its listener.
The terminal reports unconfirmed cleanup separately from any known result.
Tab closure or a lost browser connection alone does not request cancellation.
Closing a Run inspector retains its existing presentation-only meaning.
An unconfirmed Close fences further browser launches, even if later reads show settled execution.

## Local access boundary

Bind explicitly to numeric IPv4 loopback on an ephemeral port.
No LAN interface, remote host, resident daemon, browser approval, or apply action is provided.
An ordinary Run inspector controls presentation only.
The explicit explorer owns the separate launch and cancellation actions described above.

A cryptographically unpredictable, session-specific capability authorizes every
snapshot, stream, artifact and close request. The launch fragment bootstraps
memory-only browser authorization and is removed from visible history before
requests. Never put it in a query, cookie, local/session storage, result packet,
model journal, diagnostics or access logs. Reload requires reopening the
original terminal link in a new tab and does not submit work again. Possession of that link
permits reading this session and closing its inspector.

An explorer link additionally delegates its bounded project launch and close actions.
Ordinary inspector links never delegate those actions.

Validate the parser-visible Host and canonical request origin against the exact
numeric listener authority, without hostname aliases or forwarded-header
substitution. For authenticated endpoints, present Origin must match exactly. Close requires explicit exact
Origin. Present fetch-site metadata must be same-origin. No permissive CORS,
preflight exception or authentication fallback exists. Duplicate Host values,
malformed routes, unsupported queries, uploaded observer bodies and unknown artifacts fail closed.

Native parsing can normalize request targets before the handler sees them.
These checks do not claim to inspect the original request line.

Fixed bundled assets are public and carry no authority.
Terminal-link navigation accepts `Sec-Fetch-Site: none`.

Explorer project reads accept only one opaque target selector.
Run status reads accept only one optional request identity, distinct from the global current state.
Launch and Close require an explicit exact Origin and the project control capability.
Launch accepts one bounded JSON body with a ten-second read allowance and one active submission.
Compressed bodies and malformed JSON are refused before dispatch.
The explorer retains at most eight ordinary requests and two project responses, without a waiting queue.

It owns one separately authenticated child handoff, limited to 2 KiB per event.
Browser capabilities cannot authenticate that handoff, and child capabilities cannot authenticate browser control requests.
The handoff accepts only the ordinary numeric-loopback viewer URL or a confirmed settlement event.

Serve only fixed bundled host assets and the authenticated endpoints belonging to the selected mode.
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

The model retains 32 views/6 MiB per command and 8 views/4 MiB per publisher.
It retains 16 activities and 256 actual call nodes at depth 32/256 KiB metadata.
Journals and attention retain their existing finite bounds.
Encoded complete snapshots are at most 16 MiB.

 Projection/encoding failure supplies an independently
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

Bound client fetching to one snapshot task, highest notified revision, one retry timer and one active preview task.
Visible media can select at most 24 preview identities.
The browser cache retains at most 8 MiB, with at most 1 MiB per preview reply.
Capacity responses have bounded backoff.
Reconnect storms, stale completions and Close cannot restore disposed presentation or create an unbounded queue.
A newer file intent must never receive older bytes beneath its title.

Settled preview attempts remain settled while their exact intent stays visible, independently of cache eviction.
Leaving and returning to a preview or replacing its capture can initiate a new attempt.

## Application map

A live Run may include its complete admitted composition as a separate Application map destination.
Application pages remain primary, and Execution retains the actual invocation tree.
The map shows the selected root, its configured components, and each caller's available child slots.
Connections express available calls, never execution order, evaluated conditions, or confirmed external effects.

Jig projects this composition from the exact admitted generation selected for the Run.
Drawing the map never evaluates source or reads mutable project declarations.
Each Binding retains its own identity, even when several Bindings select the same Flow.
Resources retain distinct caller-slot identities, including implicit checkpoint resources.
Labels describe components but never establish identity.

The observation model accepts only opaque component identifiers, bounded labels, component kinds, resource kinds, and caller-slot connections.
It carries no settings, grant policy, private paths, execution requests, or authority tickets.
The fixed map allowance is 256 components, 1,024 connections, and 256 KiB of encoded composition per snapshot.
Exceeding any allowance makes the complete map explicitly unavailable, without trimming connections or affecting execution.
Missing admitted composition remains unavailable rather than being inferred from call history.

A call matches through its accepted caller source and exact configured slot.
Only an observed child source extends that correspondence to nested calls.
Repeated invocations remain separate observations of the same configured component.
Missing ancestry, unavailable slots, and conflicting identities remain unmatched.
Names, operation labels, arrival order, and diagnostic paths cannot supply missing correspondence.
An unmatched call remains reachable through Execution.

Selecting a component reveals its configured connections and exactly matched retained calls.
Each observed call can open the existing invocation inspector.
Counts describe retained observations, not complete history or execution duration.
Absent observations do not prove a component was skipped or cannot execute.
Observation loss and unmatched calls remain visible beside the map.
Selection persists through snapshot replacement while its component identity remains available.

The Run map supplies no editing, test submission, replay, or execution controls.
Project exploration places explicit input and launch controls beside its configuration-only map.
Saved result packets and retained application views contain no admitted composition.
They never reconstruct a map from recorded prose or familiar field names.

## Evidence and presentation

Artifact endpoints accept only an opaque retained capture identity. They never
accept absolute paths, enumerate project directories, reopen mutable destination
paths, follow recorded destinations or perform network requests. Only verified
manifest-selected immutable captures supply bytes. Root authored references
require the accepted root source, declared output attachment and verified path.
Child-only declarations remain unavailable until the parent delivers/remaps
actual evidence. The independent host file inventory does not attribute its
bytes to an unavailable authored reference.

Delivered capture retains at most 64 files /16 MiB under the confined file policy.
Selected input media uses a separate detached capture of exact original members, with `captured-input` provenance.
The root input budget remains 64 files /64 MiB, separate from the output budget.
A filename or authored path cannot select an uncaptured member.
Unknown references are filtered before applying the selected-file limit.

Text excerpts remain at most 4 KiB each, charged as UTF-16 storage.
A generation-fenced download returns complete captured bytes independently of preview clipping.
Downloads use the authenticated artifact route and exact `X-Jig-Capture-Generation` header.
One active download body retains at most 16 MiB.
The response owns its copied bytes, and Close aborts pending delivery.

A fixed disposable process accepts PNG/JPEG sources up to 8 MiB, 24 megapixels and 16,384 pixels per dimension.
SVG documents allow 8 MiB of encoded source, with 64 KiB of vector markup across all nested SVGs.
Embedded raster images share an 8 MiB decoded-source allowance and the 24-megapixel limit across at most 64 images.
Raster previews return PNG within 1,024 by 1,024 pixels and 2 MiB.
SVG previews retain their 384-pixel width and 256 KiB output limits.

SVG image upgrades retain a separate 512 KiB content ceiling, including their reserved text fallbacks.
Raster reservations cannot consume that SVG allowance. All preview content also counts against the aggregate allowance.

Retained preview content has a 48 MiB aggregate allowance, separate from complete download bytes.
Its main thread owns a five-second deadline and an open input-pipe lifetime lease.
Pipe loss or cancellation kills the whole process, whose actual exit precedes reuse.

The pinned renderer limits raster decoding to 128 MiB of Wasm memory, including SVG documents with embedded rasters.
Vector-only SVG documents retain the 5 MiB Wasm ceiling.
Cumulative imported copies and decoded text each allow 32 MiB for raster decoding and 1 MiB for vector-only SVGs.
These are image-content limits, not a hard quota on Bun's total resident memory.
External references and entities are refused.
Bundled fonts supply text.

At most one renderer runs per command, without a decoder queue.
Selected input thumbnails are decoded on demand and share an 8 MiB LRU cache.

The browser retains at most forty MiB of media replies across twenty-four visible requests.
Close aborts and joins owned decoding before releasing its captured bytes.
Saved inspection retains its ten-second aggregate image preparation limit.
Malformed, oversized or stalled images lose only their optional preview.
Their complete captured bytes remain independently available when retained.

The browser renders validated raster data in an image element, never authored
SVG markup, and retains no image object URL or file/network access. Empty,
image, non-text, unavailable and clipped evidence are distinct states. Content
is primary. Path, byte count, verified-delivery/recorded-capture provenance
and limits are secondary.

Captured-input provenance remains distinct from verified delivery and recorded capture.
A `content` block renders that captured evidence without accepting authored markup.
Gallery media, title, alternative text and description roles use declared collection columns.
All supplied fields and row details remain reachable.

Preserve diff whitespace with addition/removal/context roles and a plain
fallback. Text previews detect common formats from the captured filename.
Unknown filenames use bounded shebang, diff and complete-JSON signals before
falling back to plain text. Both renderers share detection and lexical
colouring for CSV/TSV, JSON, YAML, Markdown and common source files.

Colouring is a reading aid, not syntax validation. No grammar, file or network
lookup is performed. Web CSV/TSV previews offer Table/Raw views for complete
rectangular excerpts of at most 500 rows and 64 columns. They respect quoted
delimiters and multiline fields. Clipped, malformed and oversized tables
retain raw text.

Literal search shows the raw excerpt, preserving its whitespace and match
locations. Expansion adds space, scrolling and search of retained text.

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
reconstructing domain views or a graph from prose or familiar keys.
The separately selected application archive retains explicit display bundles under its own contract.
Manifest consistency is not authentication of the report.

Saved navigation provides one Recorded result, Captured files and Diagnostics
surface. It shows no synthetic activity history or elapsed-run claim. Private
host adapter roles distinguish these surfaces.
Authored IDs and titles never select host navigation. File-capture findings remain visible alongside the inventory.

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
detached capture transfer, selected final-bundle publication and authenticated retirement.
Include no-publication and no-preview paths.
Publication joins its original acceptance operation through cleanup, even after the allowance expires.

Fence every verb and recovery fallback before closing resources. Accept
success only after resources close, authenticated retirement acknowledgment and
expected spent-channel completion. Release local input/output captures before
waiting on the inspector.

Retain only bounded semantic presentation, captured bytes and previews.
No project lock, execution scope, channel owner or descriptor endpoint remains alive for browser inspection.
On-demand preview processes own only detached bytes and finish before their presentation owner closes.

The first retirement operation requires a confirmed terminal and successful
project closure. Unknown execution or a project-close failure closes the viewer
and local captures without spending the original source-exit recovery authority.
Bound those local joins by the existing enclosing presentation end when supplied,
without starting a new completion reserve; an unknown close stays unconfirmed.
Do not retain an indefinite unknown inspector. Once finalization has started,
later errors join its original promise and end, including a latched failure;
they cannot select another operation. Report local-close uncertainty separately
without replacing the primary error or known terminal/delivery.

Late/lost/silent acknowledgments, uncertain closes and exhausted completion
allowances close presentation finitely. Preserve any known execution and delivery
result, report separate command-cleanup failure and exit 2; do not replace a known
terminal with an invented unknown one. Shutdown closes active streams, timers,
subscriptions and retained buffers even with abandoned readers. Display failure
may fall back to ordinary presentation without canceling domain work; genuine
command output loss retains the existing cancellation policy.

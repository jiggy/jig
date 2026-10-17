# CLI experience contract

Jig's CLI serves **agency through power under control**. People must be able
to understand the task, observe progress, interpret the outcome, and take the
next safe action without a maintainer translating internal machinery.
This specification governs every public Jig command, help screen, approval,
notice, diagnostic, progress display, and installed-launcher failure. It
makes usable control an observable requirement;
[project policy](project-policy.md) retains authority over admission and lifecycle.

## Find the relevant requirement

| Task | Required sections |
| --- | --- |
| Import an agreement | [Contract import](#contract-import) |
| Select a display | [Display selection](#display-selection), [browser activation](#browser-activation) |
| Present live work | [Progress and observation](#progress-and-observation), [workspace navigation](#workspace-navigation), [automatic output](#automatic-output) |
| Present a result | [Experience acceptance](#experience-acceptance), [diagnostics and interruption](#diagnostic-evidence-and-interruption) |
| Change review output | [Implementation and review ownership](#implementation-and-review-ownership), [review client selection](#review-client-selection) |
| Explain Agent prerequisites | [Agent setup during review](#agent-setup-during-review) |
| Present file evidence | [Invocation files and fresh evidence](#invocation-files-and-fresh-evidence) |
| Change CLI behavior | [Experience acceptance](#experience-acceptance), plus every affected section |

[Project policy](project-policy.md) owns admission and execution authority.
[Web display](web-display.md) owns browser access and transport requirements.

## Required experience

### Contract import

`jig import-contract <jig:name|descriptor.json|npm:package> <new-directory>` is explicit offline
authoring. It captures and validates one standalone channel descriptor, or an invocation descriptor and its exact
channel closure (at most 64 agreements, 256 KiB per file, 1 MiB captured bytes),
preserves bytes and relative paths, and publishes only to an absent destination
whose parent already exists. An exact `npm:` selector resolves an installed
package by searching `node_modules` from the destination parent upward, nearest
first, for `FLOW.contract.json`; an existing package without that descriptor
does not fall back to a different installation. Direct descriptor paths remain
supported. It may resolve the selected source root through an installed-package
link; it rejects links within the selected closure.
It does not evaluate package code, fetch dependencies, acquire execution
authority or approve a Run. Cancellation before publication leaves no destination;
completed publication is not undone. Process loss may leave an unpublished
`.jig-contract-*` staging directory, not a successfully imported bundle.
`jig import-contract --list` lists the installed standard agreements and their
purposes without project loading or host acquisition. Exact `jig:` selectors
cover Agent Run, Project Command, HTTP Request, Run Checkpoint, Finite ACP,
ACP public updates and reporting. They copy the bundled canonical descriptor,
referenced agreements and license; unsupported names fail without a fallback.
The installed catalog checks each exact supported digest. A copied standard
agreement is a project-owned snapshot, never a runtime resolver, implementation
selection or authority grant. Reporting retains its MPL-2.0 license.

### Progress and observation

The optional [reporting profile](reporting.md) shares stderr presentation
with host progress and diagnostics. Resolve entrypoint/operator arguments first:
effective `--receive` retains ordinary stdout channel behavior, `--json` disables
automatic Flow observation, and operator-only `--updates off` disables automatic
selection/hints without cancelling explicit reception. Otherwise stderr
can observe one exact optional canonical port, using plain text when redirected.
Stdout keeps its existing envelope.
Application notices retain attribution and bypass trusted heading/success styling.
Activities are transient owned state, cleared on every end; counts and EOF never
establish success. Accepted notice jobs survive ordinary source retirement while
obsolete repaints are superseded. Host stopping/terminal presentation fences late
Flow updates. Exact bounds, separate allocation policy and output failure remain
governed by that profile and [channels](channels.md).

### Display selection

Operator-only `--display auto|plain|tui|web` controls Run presentation. Auto
selects TUI when stdin, stdout and stderr are terminals, raw input is available,
and TERM is not dumb. Missing native support falls back once to ordinary output;
explicit TUI instead refuses unavailable native support before execution.
Otherwise auto uses a bounded noninteractive inline region on suitable stderr;
it borrows no input and preserves scrollback. Ordinary output uses nonanimated
summaries with plain, NO_COLOR, TERM=dumb or redirected stderr. TUI requires terminal stdin
and stderr, independently of stdout when explicitly selected; otherwise explain
the plain fallback once. It owns one alternate screen only after trusted root
execution admission crosses the dispatch boundary. Initial review, input, file,
output and runtime prerequisite failures remain ordinary diagnostics. Entry does
not depend on application views or updates. NO_COLOR keeps TUI controls without
color. JSON and effective reception retain their exact output and disable
automatic Flow observation and TUI selection. No project entrypoint can choose
display mode.

Jig adapts accepted observations to readonly semantic snapshots from
`@jigging/display-model`. The independent `@jigging/display-tui` and
`@jigging/display-web` packages own presentation and local navigation. Jig retains
admission, actual observed call attribution, captured evidence, terminal IO and
restoration, transport, output accounting and Run lifecycle. A renderer receives
bounded data and excerpt access, never host execution or filesystem authority.
Ordinary Jig installation includes its presentation; Flow declarations remain
display-neutral.

### Browser activation

Explicit web requires terminal stderr, independently of stdin, stdout, TERM and
color support. Otherwise use ordinary plain presentation without exposing a
private launch link in redirected output. It prepares its local listener before
execution, then advertises a browser link only after trusted root dispatch and a
readable initial snapshot. It never automatically launches a browser. JSON and
effective reception take precedence before preparing a listener. Redirected
Run stdout retains exact final JSON while terminal stderr can provide web
inspection. The [web display contract](web-display.md) owns local access,
transport bounds, browser navigation and presentation lifetime.

### Host and application observations

The shell presents host execution, cleanup, delivery and complete known safe
causes separately from attributed domain reports. Execution is the actual observed
invocation tree; application views compose literal reports, facts, measured
progress and typed collections. Calls returning, reported 100%, EOF and view
status never imply domain success. Auto/plain commit complete errors and warnings
to scrollback. Explicit TUI retains them in bounded Activity and attention,
with full causes one action away from every view; leaving restores the screen and
commits complete retained essential causes before final stdout. Sticky attention
and visible incompleteness survive view retirement. Narrow layouts shrink
workspace before hiding the cause and disclose clipping.

### Workspace navigation

The explicit workspace groups host Execution, Activity and Delivered files separately
from every attributed application view. Saved inspection has exactly one Recorded
result, Captured files and Diagnostics destination, supplied by the recorded host
adapter. Author-supplied names never select host navigation. A navigation rail is
available at 150 columns and 24 rows; smaller layouts retain the current-view trail.
`v` opens a grouped chooser that reveals the selected attributed destination within
the viewport. Tab/Shift-Tab cycle the same destinations. View selection preserves
viewer-local filters, sorting and stable record identity.

All valid block types are reachable in supplied order. Lists use dense rows and
aligned declared columns, showing at most the first three fields; full expansion
retains every supplied field. Automatic context requires at least 118 columns and
24 rows and meaningful additional selected content: authored details, hidden fields,
facts, remaining or clipped report text, captured content, or an observed call's
known cause or strictly scoped related report. Generic lifecycle metadata alone
never splits the Execution view. Local action feedback remains visible without
opening a duplicate pane and without replacing sticky attention. Empty-detail
requests explain that fact. Report clipping accounts for prefixes, display cells
and encoded bytes; the complete retained source stays reachable through expansion.

Selection alone never navigates a record/call reference. A selected entry with
exactly one distinct typed artifact reference, considering all cells and supplied
details, may peek its available immutable text read-only. Entries with multiple
distinct references require explicit selection; field labels and project names
cannot choose one. Delivered files remains reachable without an application view
or automatic update reception. Explicit file selection shows content first, with
size, provenance, availability and clipping as secondary metadata. Empty, non-text,
unavailable and clipped text have distinct states. Expansion reuses the retained
preview, adds space, scrolling and literal search of the retained excerpt, and
never claims to search uncaptured bytes. Selection and capture generations fence
late completion; busy selection retries only the latest identity.

### Evidence hierarchy

The hierarchy separates list identity and brief observations, selected additional
context, and explicitly expanded evidence or invocation identity. Call details
retain readable UTC observation time; reviewed slot and original operation identity
belong to explicit expansion. Wide Execution rows may show common-scale intervals
from first to latest actual observation. Invalid or reversed clocks have no span.
These intervals are observations, never inferred execution duration, progress,
commands, results or domain verdicts.

### Terminal appearance

Navigation, headings, declared labels, typed values, measured counts and host
states have distinct foreground roles. Active calls use an accent, returned calls
remain secondary, failed calls use red and uncertain/cancel-requested calls use
amber, with explicit state words retained. Returned calls never receive a green
application-success verdict. Escaped recorded values may use lexical syntax
colors without interpreting their words as status or commands. Color-free
presentation preserves every distinction through wording and hierarchy. Large
empty panes must not exhaust the encoded frame budget or hide exit controls;
actual content overflow still discloses clipping.

### Navigation and inspection lifetime

Narrow layouts keep collapsed rows
and Enter opens full detail. Returned tree branches collapse by default; active,
failed and uncertain branches remain visible, with operator choices retained.
Activity orders recent reports first and folds informational setup history into
one expandable entry. It does not present settled work as current activity.
`d` opens attributed diagnostic reports from every view. Unknown diagnostic
severity remains unknown; text content never determines severity.
References can resolve current same-publisher
records, actual own calls and verified delivered files. Previews use bounded
immutable capture, never mutable destination reads. Escape dismisses local help,
filter, view/reference selection, attention, preview or detail first. Explicit typed
record/call jumps retain at most 16 return origins with surface, stable record and
scroll identity. Escape then returns through that history, skipping retired
intermediate destinations in one action and repairing removed rows to a preceding
survivor. If all origins retired, it remains in the current valid view with action
feedback. Return navigation checks any
explicit enclosing lifetime before mutation. Tab and chooser destination selection
clear return history. Escape at the top level stays in the TUI. q or keyboard
Ctrl-D asks “Leave the TUI?” with Stay selected; arrows or Tab choose and Enter
confirms, while Escape stays. Repeated q never confirms. Live confirmation explains
that work continues in the terminal; settled confirmation closes read-only
inspection. Cancellation stays available while the prompt is open, and changes
to observed content cannot dismiss or approve it. Confirmed live exit or actual
input EOF restores input and continues inline, without re-entering later. Live Ctrl-C uses
existing cancellation and cleanup. After all execution, cleanup and delivery
settle, an inspector still open shows literal settled facts and read-only results;
if the operator has not navigated, it selects the root publisher's landing view
or first retained root view and its first row when present.
q or keyboard Ctrl-C then asks before closing presentation, without changing the admitted outcome.
No Flow or channel remains alive for inspection. Inspection has no built-in idle
or absolute expiry; it remains open until the operator leaves, input/output fails
or an external interruption closes it. Explicit inherited enclosing command
constraints still apply, and no input or repaint extends them. Eligible interactive
effective TUI commands omit the default enclosing presentation lifetime,
while setup, Run execution, cancellation and cleanup keep their own bounds.
Execution elapsed time freezes at settlement. An expiring explicit presentation
constraint leaves live execution running through its ordinary owner; it never
extends an execution timer. Immutable delivery inspection is selected before
capture/publication even though screen entry waits for dispatch. Every exit releases preview,
input and presentation owners. Auto/plain emit one selected root summary with
ended/incomplete context and exit promptly. Prefer the current root landing view,
otherwise its first retained view in accepted order. Never resurrect retired
views or repeat an unchanged summary merely because observation ended.

### Automatic output

The automatic inline region is a compact work projection, not a reduced interactive
workspace. Show target, observed stage/time, the attributed root summary, up to four
actual root branches and current activities. Call joins use publisher-scoped operation
IDs only; activities without an association remain attributed and visible. Counts
are measured reports, not inferred completion percentages. Reserve attention before
ordinary work rows, disclose omitted branches/activities and retain a brief selected
context after leaving TUI. Do not dump collection row details or every report here.
Plain scrollback prints the initial root summary once, meaningful activity transitions,
notices and causes, then a changed root summary at settlement. Other views remain
available in TUI/web. Final evidence remains independent of optional updates.

### Experience acceptance

1. **Task first.** Identify the requested task and relevant project or target.
   Name stages in ordinary language. Internal lifecycle and implementation
   terms appear only when needed to understand or repair a problem.
2. **Stable progress.** Acquisition distinguishes Jig runtime verification,
   preparing operator resource configuration, and opening project state with
   recovery checks. Native runtime verification occurs only when a target selects
   an ACP resource; capturing configuration must not imply that a client was
   verified. These labels describe actual work, not a generic prerequisites wait.
   Review reports project-source capture, per-package dependency-input capture,
   dependency preparation or approved reuse, and final recipe/review retention
   separately. Active elapsed time belongs to the current stage. In animated
   terminals, completed timed stages retain their duration as secondary text.
   Ordinary acquisition has one active line with elapsed time; running work can use the
   bounded inline dashboard above. Explicit TUI retains stages inside its
   Activity view. Preserve completed stages; never mark a failed or merely
   departed stage complete. Update waiting time in place, not by appending
   unchanged messages. Report the known wait reason; never invent percentages,
   estimated completion times, or internal Flow stages. Finish or suspend the
   active line before prompts, notices, streamed diagnostics, or results. Await
   queued progress output before reading any answer so the answer remains beside
   its question without intervening status output.
3. **Consistent visual hierarchy.** Use bold task/section headings and final
   outcomes, green completion, amber warnings, and red failures. Text must
   carry every meaning independently of color or symbols. Use foreground colors
   without background fills; provide syntax palettes for light and dark terminals.
   Actual action commands and examples use standalone `  $ jig ...` (or `cd`)
   lines when enabled; the prompt prefix remains in plain output. Command names
   use bold syntax accents, flags, placeholders and argument literals have distinct
   accents, and punctuation is secondary. Help and host command references omit
   Markdown backticks. Commands never
   wrap, shell quoting remains exact, and examples with placeholders are labelled
   templates. Recognize commands only in host prose, never application data.
   Target readiness retains explicit words, green for ready and amber for unavailable;
   readiness is not execution.
   Narrow terminals must retain complete consent and recovery information;
   only the transient progress label may shorten to fit. Separate major terminal
   sections with a blank line, a restrained horizontal rule, and a bold heading;
   keep individual records and their fields grouped beneath that heading. Plain
   terminal mode preserves these boundaries without escape sequences.
   Use the terminal's gray for secondary metadata: hashes, diagnostic codes,
   categories, change counts, completed-stage text, elapsed time, and optional
   detail notes, executable paths, and unchanged context. Changed-record labels,
   including their identifiers, use bold amber to draw attention to changed work.
   Omit review categories with no changes from the ordinary summary. ACP selections
   are omitted only when matching ready targets prove unchanged runtime identity
   under identical recipient routes. Identical request, recipe and observation
   identities provide that proof directly; changed source requires both retained
   identities to match recomputation under the current authenticated environment.
   New, changed or unknown environments keep current selections visible;
   `--details` always shows them. This presentation comparison neither approves
   nor authorizes execution. A combined mismatch cannot identify which environment
   component changed.
   Keep permission consequences, changed policy values, failures,
   and next actions at normal or emphasized contrast. Gray never hides content
   or substitutes for labels, spacing, or explicit status words.
   A heading must never be less prominent than the details it introduces.
   Expanded unavailable-client labels use bold amber above normal-contrast
   setup instructions; compact names-only summaries remain secondary gray.
   Render structured human values as YAML using the shared standard serializer:
   mappings, sequences, empty containers and multiline block strings convey types
   without `(object)`, `(list)` or `(text)` labels. Quote strings and keys to preserve
   exact JSON types and safe text. Preserve whitespace inside block strings, including
   blank lines; never wrap or interpret their contents as status or headings.
   Highlight keys, strings, numbers, and literals without changing their escaped
   bytes. Keep punctuation neutral and hashes secondary.
   `JIG_THEME=one-dark` (default), `one-light`, or `macchiato` selects syntax
   accents for the terminal background; unknown values fall back to One Dark.
   Use truecolor when `COLORTERM=truecolor` or `24bit`, approximate accents for
   `TERM` containing `256color`, and basic terminal colors otherwise. Theme
   selection is a shell preference available before project loading, not a
   `jig.ts` authoring or approval setting. Plain output ignores themes.
4. **Readable failures.** Order the failure summary, relevant location, known
   explanation/recovery, and diagnostic code. Codes support search and software;
   they must not replace the explanation. Name known missing prerequisites.
   Unknown causes stay unknown, with a bounded diagnostic step rather than a
   guessed repair or raw exception. Explicitly identify absent diagnostic text
   and an unretained cause; never direct users to inspect nonexistent evidence.
   Show one failure explanation, retaining additional details without repeating
   the raw status/code/message as a separate result block. Explain whether work started and whether
   effects or cleanup are uncertain whenever that affects recovery.
   Preserve value-free expected/received JSON type facts for schema type errors
   across planning and execution boundaries. Never echo rejected values or
   arbitrary worker messages to manufacture a more detailed cause.
   Schema authoring failures identify the required FLOW Schema/0 root identifier
   when `$schema` is missing or wrong. Invalid JSON, unsupported keywords,
   references and exceeded limits give bounded corrections and the relevant
   FLOW specification, without echoing rejected values or compiler exceptions.
   Missing or invalid files in the installed Jig runtime have a closed
   installation-repair explanation; raw paths and filesystem exceptions remain
   private, and a later revalidation failure must not imply that no work started.
5. **Useful next actions.** Successful setup and review identify the next
   supported action. Failures give a verified command, specific correction, or
   relevant documentation when available. Never invent commands or recommend
   bypassing safeguards. Commands containing user values must be shell-safe.
6. **Explicit authority.** Show consequential permission scope before effects.
   A supplied grant is acknowledged, not requested again. Dependency resolution
   notices retain public/private-network access, pre-validation effects,
   irreversibility, possible rejection, and review-only scope. Emit one notice
   per review before its first network-enabled dependency preparation, covering
   all packages; retain per-package progress without repeating the warning. Approval shows
   every changed public policy record; `--details` includes unchanged policy.
   Show public changes as contextual field diffs with explicit `-` previous and
   `+` proposed markers, preserving exact values and container types. Omit
   unchanged fields in the ordinary summary; additions/removals retain the complete
   affected value. `--details` uses the same sectioned diff view, including unchanged
   records and unchanged fields as context. Change counts and record labels belong
   outside YAML values. Never dump change bookkeeping or wrap the review in
   `current`/`proposed` snapshots. A detailed changed record must retain enough
   context to reconstruct both complete public values from its diff.
   When retained execution or a selected child changes but public target fields
   do not, identify the changed execution environment, prepared files, or child
   selection and explain what approval authorizes. Unchanged source, dependencies,
   settings and permission reassurance appears only in `--details`. A combined environment fingerprint does
   not identify individual old components; disclose this limitation rather than
   inventing a component diff. Never substitute an opaque "retained identity"
   label or identical before/after blocks for an explanation.
   Object key order alone is not a change; array order remains meaningful.
   Presentation must not hide policy behind truncation, decoration, or a pager.
   A known mismatch between the current execution environment and the approved
   recipe must request `jig review`, not become a generic execution failure.
   Say no Flow started only when the host established a pre-execution refusal.
   Agent selection uses ordinary Flow targets and explicit resource grants;
   see [Agent Run](agent-run.md). Missing selections identify the unresolved
   target or resource. Review does not install an Agent, invent a Binding,
   or choose a client on the operator's behalf.
7. **Honest completion.** Command success follows required cleanup. Execution
   completion, application outcome, delivery, and cleanup remain separate.
   After a confirmed terminal and project closure, every display mode retires
   delivery authority through its authenticated acknowledgment and spent-channel
   completion before command success, including record-only runs. Plain and
   machine output request no inspection excerpts. Retirement uses the same
   finite completion allowance and existing presentation minimum as inspection;
   later error/finally joins retain the original operation and failure.
   Without a confirmed terminal or when project closure failed, close presentation
   and local captures without spending the original recovery authority. Bound
   those local joins by the existing enclosing presentation end without starting
   a new completion reserve. Unknown work cannot retain an indefinite inspector.
   Preserve the primary error and known execution/delivery while reporting
   local-close uncertainty separately;
   do not invent a terminal or mask the original cause with a finally error.
   Cancellation requested is not cancellation complete. Lost work and unknown
   delivery never invite automatic replay. A declined review is a decision,
   not a crash; already incurred dependency effects are not undone.
   Human Run output leads with host-observed execution and application outcome,
   packet delivery when requested, and unconfirmed cleanup when known. Preserve
   arbitrary small application output afterward; field names never establish
   success. When a complete result packet is confirmed written, the terminal
   may summarize large application output and checkpoint evidence by pointing
   to `result.json` instead of repeating them. An uncertain or failed packet
   delivery must not cause the terminal to hide result evidence.
   For a large object with a written packet, retain a bounded view of up to eight
   top-level scalar fields totaling at most 2048 JSON characters. State that this
   is a brief view and the full result is stored. Do not interpret field names or
   text as trusted status, truncate individual values to make them fit, or change
   machine output. This lets an application provide a concise report alongside
   large nested evidence without a special summary field or domain adapter.
   Emphasize failed execution and unconfirmed cleanup in red, uncertain execution
   or delivery in amber, and completed execution or written delivery in green.
   Keep the same explicit status words when color is disabled. Application
   outcomes do not inherit a success verdict from completed execution.
8. **Progressive detail.** Ordinary output supports the next decision. Exact
   review details, Run JSON/NDJSON, and bounded diagnostics retain their roles;
   no debug flag is implied. Never hide important failures or authority notices
   behind an optional mode. Do not expose secrets or private host state.
9. **Automation and accessibility.** Terminal Run stdout defaults to a readable
   result and labelled live channels. Join text fragments without invented line
   breaks; preserve paragraph breaks, non-text values, channel switches and
   closed/failed endings. Channel closure is not execution success. Application
   result schemas remain arbitrary; never infer success from text or field names.
   Summarize captured diagnostics only when the exact text was already streamed;
   retain unseen diagnostics and truncation information. Escape untrusted controls.
   Redirected Run stdout or explicit `--json` remains exact JSON or NDJSON;
   version stdout remains the version alone. Human status uses stderr.
   Redirected streams contain no terminal escapes or animation; failures and
   consequential notices remain readable. `NO_COLOR` (including an empty value)
   and `TERM=dumb` select plain automatic presentation without animation; an
   explicitly selected eligible TUI with NO_COLOR uses screen controls
   without SGR styling. Plain terminal
   progress reports stage changes once. Do not require Unicode, a pager, cursor
   hiding, an alternate screen, or interactivity for ordinary output. Explicit
   dashboard uses an alternate screen and restores prior input/screen ownership.
   Escape untrusted control and
   review Unicode characters before presentation.
10. **Acceptance is required.** A CLI-affecting change must check rendered
    success, failure, long waits, cancellation, and uncertain cleanup, plus
    redirected output, color disabled, narrow terminals, and light/dark themes.
    Verify byte-exact machine records, diagnostic safety, complete changed
    policy, and no premature success. An unfamiliar reader must be able to
    identify the outcome and next action from the transcript alone.

### Installation verification help

Help for review, Run and inspection exposes the operator's
`--verification cached|strict|fast` argument and names cached as the default.
Precedence is argument, then `JIG_VERIFICATION`, then cached. Missing, invalid
or repeated argument values are usage errors before host acquisition; a valid
argument overrides even an invalid environment preference. Parse it through
each command grammar, never by scanning values supplied to other options.
Explain fast mode's missing installation-freshness check and initial hashing
on cache misses; never imply that it bypasses approval or containment. Invalid
environment values without an argument override produce `JIG_VERIFICATION_INVALID`
with accepted settings and no Flow started. Help and initialization remain available without valid verification
configuration. The exact guarantees belong to
[installation verification policy](project-policy.md#installation-verification-policy).

## Implementation and review ownership

Syntax errors show a bounded explanation and the relevant `jig <command> --help`
hint, not the complete manual. A close spelling suggestion never changes or
executes the supplied command.

`jig run` without a target uses the approved project `entrypoint` and its default
arguments, in terminals and scripts. Explicit options override defaults according
to [Project Authoring SDK/1](project-sdk.md#project-entrypoint); an explicit target
bypasses them. Show the selected target and effective file paths and duration
before work, without printing input contents. Review shows entrypoint additions,
changes and removal; inspection includes the approved declaration.

Without an entrypoint, interactive `jig run` presents numbered ready approved targets
and their retained descriptions before execution acquisition. Empty input
cancels; noninteractive invocation requires an exact target. Selection does not
approve visible edits or bypass Run validation. Approval changing between
selection and submission refuses the invocation with `RUN_APPROVAL_CHANGED`.

`jig completion bash|zsh|fish` prints shell integration. Its dynamic
`jig completion targets [prefix]` lookup reads only approved selectors, without
environment checks, source evaluation, state writes, or provider requests.
It emits one ready selector per line; unavailable targets yield no suggestions.
Static completion offers `--agent` values `codex`, `claude` and `pi` for review
and init; review requires one value, and Run has no client option.

Target inspection includes `boundReadAttachments`, the names of reads already
captured by that Binding. Invocation templates omit those names and explain
that they cannot be overridden; they supply only unbound reads. Inspection
separates approval freshness from retained target availability. An unavailable
default is identified using its normalized selector and is never presented as
a ready bare invocation.

Human inspection supplies invocation guidance from the retained interface:
required fields, file placeholders, and channel requirements. Input examples
are explicitly templates, not invented schema-valid domain data. Required
incoming channels are identified as needing a Flow caller, not a runnable CLI
example. Machine inspection includes the optional approved `entrypoint` string
and retained `agentOverride` in both project and target views. Human inspection
explains that retained review-argument origin; current source never supplies it.

`jig new <name> [--use slot=source]...` creates `flows/<name>` in the current project, never overwriting
an existing path. It does not evaluate `jig.ts`, install dependencies, modify
membership, or approve the new Flow. The SDK dependency follows the project's
explicit package manifest declaration when present, otherwise the tested SDK.
Explicit membership arrays must be edited by the author before review.

Optional `--use` declarations select at most 16 distinct contract slots. Each
source is a `jig:` standard invocation agreement, a project-relative descriptor path or an exact installed `npm:` package
name; npm lookup starts in the project and searches its ancestors, nearest first.
Each complete validated bundle is copied unchanged to `contracts/<slot>`, and
`FLOW.meta.json` references its descriptor under `uses.<slot>`. The generated
implementation remains a simple input return: the author decides how to call
collaborators and which optional features to require. No provider, grant, library
dependency or execution authority is inferred from a contract.
Creation with contracts stages the complete source outside `flows` discovery,
then publishes to an absent destination. Failure or cancellation before publication
removes unpublished source; completed publication is not undone. Process loss
can leave an unpublished `.jig-new-*` directory in the project root.
## Diagnostic evidence and interruption

Configuration-evaluator refusals retain the captured declaration location and
a closed diagnostic distinguishing installation support, containment launch,
envelope validation, cleanup, interruption and protocol response. Human guidance
explains the known phase and next safe action; it MUST NOT expose launcher
exceptions or infer a particular host or timeout cause from generic launch
failure. These planning diagnostics establish that no Flow was started.
Enforced evaluator memory, process and wall-clock limits have distinct closed
diagnostic codes. A wall-clock refusal does not identify which phase consumed
the budget. Generic capture or execution limits retain that uncertainty instead
of attributing the failure to host load.

Run reports retain optional `runDiagnostics`: `entries` contain the host-assigned
`operations` call path (empty for the root), `stderr`, `stderrBytes` and
`stderrTruncated`; `truncated` marks any lost diagnostic evidence. Retention is
bounded to 64 KiB across 32 emitting invocation paths. These are untrusted
diagnostic bytes, not application results. The existing terminal `diagnostics`
continues to describe root-process stderr only. Live rendering escapes control
characters and identifies changes of emitting invocation.
Human final results count invocation paths whose diagnostic text was already
shown live, without replaying it or creating a result section for that count
alone. Retain any unseen suffix and disclose capture truncation with its path.
Unseen text appears in a separate human diagnostics section, without the machine
capture's byte-count or field-name bookkeeping. Escape it as literal data;
neither command recognition nor prose-based severity inference applies.
Interleaved invocation paths are tracked separately. JSON records and result
packets retain their complete bounded captures independently of this presentation.
Human output omits packet provenance manifests and digests already retained in
`result.json`; identify that file when delivery is confirmed. When a successful
Run has a confirmed written packet, keep small application output visible but
refer to `result.json` for large output, patch contents, and full checkpoint
evidence. Show the delivered file count when known. If delivery is uncertain
or failed, keep result evidence visible. Retain unseen diagnostics and failure
details, then end failed Runs with the explanation and next safe action so
evidence does not bury recovery.
Do not repeat delivery and cleanup records already explained by the summary.
Omit a null checkpoint and a zero delivered-file count from human results;
their exact machine values remain unchanged.

Input errors name the approved schema and the rejected field when known. Explain
that source edits need `jig review`; an input mismatch alone does not prove an
outdated review. Run does not inspect or approve live source to guess freshness.
Native Agent setup failures identify the selected client and a closed cause,
separately from corrective guidance. Locate the selection at its captured Binding
declaration and resource slot when known, instead of the provider's executable
Flow file. Never expose private exception text or invent the source location.
When that slot is known, explain how to select another supported client in its
inline or named ACP grant and review the change, alongside repairing the selected
client. Never select a fallback or approve a changed execution identity implicitly.
An ineligible direct child Flow diagnostic explains that its slots or settings
need configuration through project defaults or a selected Binding.

After interruption, the command waits for owned cleanup and emits its observed
authoritative terminal when available, with `command: {status: 'interrupted'}`
and exit 2. Execution status remains unchanged if completion won the race.
Cleanup failure is reported separately. A missing terminal, coordinator loss,
or broken output stream cannot be replaced with a fabricated terminal; consumers
must still handle incomplete output. No reporting path replays execution.
With a packet destination, confirmed settlement after interruption may publish
the terminal record and an already accepted checkpoint. It never exports unfinished final
Flow files. The trusted command's bounded settlement wait does not extend the
Run deadline; forced termination still leaves unavailable evidence unavailable.

### Agent project initialization

`jig init <directory> --agent codex|claude|pi` optionally authors a declared
Agent dependency, `bindings/agent.ts` with an inline ACP grant, and a
contract-keyed default in `jig.ts`. Bare `--agent` asks for an explicit choice
on a terminal; empty input cancels. Noninteractive use requires the client
argument. Selection
does not inspect or install a client, copy authentication, resolve dependencies,
or approve authority. `--bare` omits the greeting, not the explicitly requested
Agent configuration. Existing destinations are never overwritten.

### Review client selection

`jig review --agent codex|claude|pi` requires exactly one supported value, even
on a terminal. It proposes that client for every selected normalized ACP policy
before qualification. It changes only `client`; declarations and named grants
remain unchanged. The argument neither creates an Agent nor changes HTTP grants,
Flow/package routes or ordinary provider selection. Run has no corresponding
flag and never substitutes a client at execution time.

Before approval, show source and effective clients, the review-argument origin
and all affected selections within ordinary truthful report bounds. Retain this
selection summary even when the ordinary policy diff is empty; same-client
and unchanged review still disclose the explicit operand. Mixed source
clients use the same global selection. A same-client no-op preserves every field
and still undergoes qualification. Refuse the complete request when no ACP
policies are selected, or when an actual cross-client change has a model pin or
incompatible session retention. Do not clear, translate or infer those fields;
preserve `maxTurns`. A pin refusal explains this argument's restriction rather
than asserting model incompatibility or a native setup failure.

Normal exact approval and new/changed resource-authority opt-ins still apply.
The argument grants neither resolution networking nor execution. A later review
starts from its newly captured source and explicit arguments: it does not inherit
this selection from a lock, admission or environment. When bare review proposes
returning to a source client, explain that change before approval or in the
refusal. A failed review retains the earlier approved code and client together.
Inspection identifies the approved effective policy and retained origin without
inferring a past argument from current source. An originating source Pi literal
must never be presented as an originating Codex literal.
[Project policy](project-policy.md#review-client-selection) owns exact candidate
and lock semantics.

### Agent setup during review

Any observed typed prerequisite refusal for a selected ACP resource stops CLI
review after resource qualification and before avoidable target execution
preparation, apply or an otherwise unchanged success. The same refusal
applies to interactive, noninteractive, redirected and `--yes` use, even when
unrelated code targets are ready or an input might avoid a selected Agent branch.
An unselected missing client does not block review. Installation and credentials
never break provider ties. SDK per-target readiness and selected-route
propagation remain intact; the CLI decision does not make unrelated feature
qualification failures fatal. Arbitrary failures, interruption, integrity faults
and unconfirmed cleanup retain their existing fatal behavior.

Retain the authoritative typed qualification cause independently of bounded
presentation. An incomplete, absent or saturated issue report cannot permit
approval. Do not substitute a generic unavailable-target count for an ACP cause.
State that an observed selected Agent prerequisite stopped project review, and
that a ready code entrypoint does not bypass it. Do not claim that skipped or
remaining checks completed. Prior admission remains unchanged and never bypasses
current Run admission or environment checks. No Flow or model call starts.
Review may already have prepared dependencies or written explicitly requested
`--generate-contracts` outputs; it promises no new approval and no automatic ACP
policy write, not that no other work occurred.

The ordinary error presents, in order:

1. A concise title and known cause, retaining the existing diagnostic code and
   unavailable-setup exit 2.
2. The captured policy location, affected Binding/slot and effective selected
   client. Inline policies identify the Binding; named policies identify their
   JSON file and compactly list affected recipients. If a review argument supplied
   the client, distinguish that origin from the source client.
3. Passively detected alternatives only for executable-unavailable failures,
   labelled as executable detection, not authentication, native qualification or
   universal compatibility. Discovery executes no client and reads no secrets.
4. Repair for the selected client's installation or rejected path override,
   alongside conditional manual source changes or explicit review-client selection
   for detected alternatives. An unusable explicit override is not proof of a
   missing installation; identify the override name, never its value, when known.
   Otherwise use honest override-or-PATH wording. Other setup causes receive their
   own repair, and unknown/internal failures retain uncertainty and safe public
   diagnostics. Mention model pins or retention only when present, preserve turn
   limits and never rank clients or imply compatible retention.
5. One shell-word-formatted retry command for the same project and explicitly
   requested review options. Never add networking, `--yes` or
   `--allow-authority-changes` to recovery advice. Commands retain a readable `$`
   prefix/plain fallback; paths never become shell operators.
6. No new approval, any existing approval unchanged, and no Flow started.

Place repair and the exact retry before report accounting. Compact output retains
known omissions and uncompleted checks; complete observed counts and limit
reassurance belong under `--details`. For a detected executable alternative,
an unpinned policy without retention may suggest adding or replacing `--agent`
on the shown retry. Explain its global scope, unchanged source and need to repeat
it on later reviews. Other policies can refuse the choice; detection never
promises authentication or readiness.

Locations MUST refer to immutable source captured for this candidate. A direct
non-overridden declaration or JSON policy may use a syntactically verified client
literal/property location. Imports, aliases, spreads and computed values use a
verified supplying expression labelled as selection context, or the captured
Binding file and logical slot with an explicit statement that no exact client
line was located. Equal text or evaluated values do not prove provenance. Never
present a comment/string search match as the originating selection or reopen live
source for potentially stale coordinates. A snippet contains only the verified
selection span and allowlisted policy facts, escaped and clipped as literal data.
Do not expose unrelated policy, raw private errors or credentials. The next review
captures an edit afresh.

Group observed issues by actual policy/selection, not solely by client. Avoid
repeating all transitive targets. Qualification may stop at its first failing
slot per target; identify incomplete checks without a second qualification pass
solely to exhaust possible failures. Large affected sets use bounded summaries
with known omitted counts and the existing `--details` route. Details expands
retained observed facts, performs no new checks and cannot recover discarded
facts. Both views disclose their bounds; preserve the primary blocker under
output saturation. Human output remains actionable without color and when
redirected.

No interactive Keep/Cancel/Update-client chooser, automatic source correction,
publication owner or recapture/edit loop exists. `--yes` never chooses a fallback
or writes ACP policy. `jig review --json` remains an unknown option; this contract
adds no review JSON envelope or public diagnostic DTO. Run and inspection retain
their existing machine framing and SDK diagnostic contracts. Captured owners,
locks and qualification resources close normally; diagnostics cannot retain
authority or conceal cleanup uncertainty.

### Invocation files and fresh evidence

When an effective invocation omits `--out`, a retained approved target declaring
a read-write attachment receives a fresh packet destination in canonical
operating-system temporary storage. Result-only targets stay stdout-only;
unknown targets and unreviewed projects follow ordinary refusal handling without
fabricated file requirements. Select the destination before file ownership or
host-delegation reexecution and preserve both output and no-output decisions
through every subsequent owner under the same retained admission.
An explicit `--out DIR` replaces an entrypoint output default and retains exact
destination semantics. Selection reserves nothing. Ordinary anchored-parent
validation, input-root/protected-path exclusion and no-replace publication remain
required, including for a known unavailable writable target. Invalid temporary
parents refuse before dispatch with actionable `--out` guidance; there is no
fallback or retry after work. Show the actual destination on stderr in human and
machine modes. Preserve JSON/NDJSON framing, existing delivery fields and the
terminal record's equality with saved `result.json` when a packet is written.
Explain on the first-run path that operating-system cleanup may remove temporary
packets. `--out` chooses a retained location; an existing destination is never
overwritten.

Initial file-mapping refusal identifies the missing unbound read names, invalid
mapping names, bound overrides and writable names needing a destination. Say
no Flow started. If no known fixture/schema path is available, give a clearly
labeled command template using those declared names. Do not reopen live source
or invent file paths. Checking invocation inputs and admitting the reviewed
target precedes workspace entry; invalid input, review, runtime or file
prerequisites remain in ordinary output before TUI or browser launch.

`jig inspect [flow:path|binding:id] [--json]` is read-only inspection of the
current project's last locally approved snapshot. Without a target it lists
exact approved selectors; with one it projects retained package descriptions,
invocation contract, settings schema, configured settings, resolved slots and
resource grants, and attachments. Channels belong to the invocation contract.
It compares each selected target's retained recipe and observation
identities with the current installed runtime, local Agent configuration/support,
and sandbox support, using the same identity calculation and operator-selected
installation verification policy as Run. Fast mode compares cached installation
identities without establishing current byte freshness. A selected
Binding includes its child targets; unrelated targets do not affect an exact
target's result. No target argument checks all approved targets.

The top-level and listed target `state` is `environment-matches`,
`review-required` for a known mismatch, or `unchecked` when comparison cannot
complete. A known mismatch takes precedence over an unchecked comparison.
Missing local approval reports `unreviewed` and needs no environment inspection.
A pending/declined review or a portable `jig.lock` does not substitute for
local approval. Successful snapshot reads return exit 0 even when review is
required; automation must examine `state`.

Inspection may read operator credentials to construct the same non-secret
provider identity, but never publishes or retains them or sends provider requests.
It never evaluates visible source, fetches dependencies, acquires execution
authority, probes namespace execution, recovers state, or writes project state.
It may run the selected trusted Bubblewrap's bounded `--version` query.
The display identifies its retained basis: source freshness, launch readiness
and remote availability remain unchecked. Run still revalidates before execution.
Changed or unchecked environments recommend `jig review`, not `jig run`.
Unsafe, incompatible or busy state produces a bounded diagnostic without repair.
Redirected output or `--json` is JSON, never styling.

`jig inspect --result <directory> [--display plain|tui|web] [--json]` reads a
saved packet without loading a project, verifying an execution installation,
reading operator configuration or credentials, acquiring execution authority,
or contacting a provider. It rejects target and verification arguments. Plain
is the default; JSON or redirected stdout takes precedence over either inspector.
Saved inspection displays fixed Recorded result, Files and Diagnostics views.
Recorded result separates bounded selectable fields, including ordinary output
members, from their expanded literal values. No application field name receives
special summary or outcome meaning. Scalar values shown completely in the list
have no redundant expansion; multiline, shortened and nested values retain bounded
evidence and explicit excerpt limits. Exact JSON inspection retains the full report.
Every saved value is a recorded local claim, including host-shaped fields;
matching file digests establish manifest consistency, not authenticated provenance.
Current packets retain no portable views or invocation history, so inspection
MUST NOT reconstruct either. Only the selected packet directory supplies files;
recorded destinations or attachment names cannot select another path.

Capture holds a descriptor-confined packet root and opens `files/` as its child.
Public relative file paths retain their own path profile before that prefix is
applied. Refuse links, multiple-link files, special files, traversal, duplicate
manifest paths and out-of-profile sizes. Capture admits at most 16 MiB of JSON
value plus the publisher's single framing LF, 64 manifest files and 16 MiB
aggregate file bytes, within ten seconds. File previews use already verified
immutable captures, with at most one active 64 KiB UTF-8 excerpt or bounded
image preview under [the shared captured-image profile](web-display.md#evidence-and-presentation).
Terminal images use native coloured blocks within the existing 32 KiB frame
ceiling. Colour-free terminals retain image metadata with a colour requirement;
no image overlay process or terminal graphics protocol is launched.
They never reopen a mutable path. One owner releases descriptors and captured buffers on every exit.
Partial file verification preserves the valid report and already verified
captures while disclosing unavailable evidence. It never invents replacement JSON.

Exit 0 means valid report and complete consistent file capture, regardless of the
recorded execution outcome; exit 1 means invalid/unavailable report, incomplete
file verification or output failure; exit 2 means external interruption.
Explicit JSON emits the unchanged decoded report even when file capture is
incomplete, with findings on stderr and exit 1. Invalid reports emit no fabricated
record. Terminal text is escaped literal data. Saved inspection remains open until q, contextual Escape or keyboard Ctrl-C,
subject to explicit inherited presentation constraints and input/output failure
or external interruption. It acquires no execution lifetime and has no built-in
idle or absolute expiry on any supported host.
Web preparation/activation follows valid report decoding and bounded capture;
invalid reports stay plain. Partial capture may open with a valid report and
explicit unavailable files. Close inspection releases presentation globally and
prints the ordinary recorded report; browser disconnection does not close it.

The CLI's shared presentation and progress modules own human formatting;
command branches supply facts. Installed-launcher errors follow the same
hierarchy even when the application cannot start. Review policy is generated
from the same captured records that are approved, and human Run summaries
come from the same terminal observations as machine results.

### Installed application execution

`jig attempt <prepare|submit|lookup|cancel|result|export> --json` is the
machine-only application boundary specified by
[the execution client contract](execution-client.md). Its help remains ordinary
human output and acquires no execution host or stdin lifetime.

Machine requests contain `protocolVersion: 1`, the selected `operation`, and
`request` in one bounded JSON line on stdin. Tickets, captured input and
application data must not be placed in command arguments or diagnostic text.
Validate the complete command grammar before acquiring execution support, and
validate the request before invoking the operation. Invalid requests emit one
closed typed error record, without rejected data or a fabricated execution
terminal. Machine stdout contains only the operation's versioned records.

Completing the request line is not closing the submit connection. The original
submit owner retains its finite foreground connection through settlement;
disconnecting it requests cancellation of that Run, not detached execution.
Duplicate observers receive the original acceptance without acquiring ownership,
and observer disconnection cannot cancel the original Run or another root.

Preparation and lookup never dispatch. Cancellation acknowledgement is not
cleanup confirmation. Result availability and export delivery are separate
from the immutable execution terminal. Failure advice must direct callers to
reconcile the original ticket, never mint replacement work automatically after
uncertainty, expiry, lost acknowledgement, or missing retained evidence.

Changes to public output must update this contract when its guarantees change,
its owning implementation, and focused acceptance tests together. Adding an
ad hoc raw diagnostic or weakening an assertion to accommodate unreadable
output is not an acceptable shortcut. Recovery advice remains subject to the
[results guide](../guide/results.md) and exact lifecycle contracts.

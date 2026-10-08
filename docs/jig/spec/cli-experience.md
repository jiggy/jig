# CLI experience contract

Jig's CLI serves **agency through power under control**. People must be able
to understand the task, observe progress, interpret the outcome, and take the
next safe action without a maintainer translating internal machinery.
This specification governs every public Jig command, help screen, approval,
notice, diagnostic, progress display, and installed-launcher failure. It
makes usable control an observable requirement;
[project policy](project-policy.md) retains authority over admission and lifecycle.

## Required experience

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
ACP public updates and user-updates. They copy the bundled canonical descriptor,
referenced agreements and license; unsupported names fail without a fallback.
The installed catalog checks each exact supported digest. A copied standard
agreement is a project-owned snapshot, never a runtime resolver, implementation
selection or authority grant. User-updates retains its MPL-2.0 license.

The optional [user-updates profile](user-updates.md) shares stderr presentation
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

Operator-only `--display auto|plain|dashboard` controls Run presentation. Auto
uses a bounded noninteractive inline region on suitable stderr; it borrows no
input and preserves scrollback. Plain, NO_COLOR, TERM=dumb and redirected stderr
use nonanimated summaries. Explicit dashboard requires terminal stdin and stderr,
independently of stdout; otherwise explain the plain fallback once. It owns one
alternate screen only after trusted root execution admission crosses the dispatch
boundary. Initial review, input, file, output and runtime prerequisite failures
remain ordinary diagnostics. Entry does not depend on application views or updates. Explicit dashboard
with NO_COLOR keeps screen controls without color. JSON and
effective reception retain their exact output and disable automatic Flow observation.
No project entrypoint can choose display mode.

The shell presents host execution, cleanup, delivery and complete known safe
causes separately from attributed domain reports. Overview is the actual observed
invocation tree; application views compose literal reports, facts, measured
progress and typed collections. Calls returning, reported 100%, EOF and view
status never imply domain success. Auto/plain commit complete errors and warnings
to scrollback. Explicit dashboard retains them in bounded Activity and attention,
with full causes one action away from every view; leaving restores the screen and
commits complete retained essential causes before final stdout. Sticky attention
and visible incompleteness survive view retirement. Narrow layouts shrink
workspace before hiding the cause and disclose clipping.

The explicit workspace has stable Activity, Overview and attributed domain tabs,
labelled collection cards, collapsed reports, record details, local filter/sort,
scrolling and explicitly selected references. All valid block types are reachable
in supplied order. Wide layouts project selected literal details beside the list;
selection alone never activates a reference. The information hierarchy separates
list identity and brief observations, selected additional context, and explicitly
expanded evidence or invocation identity. Lists preserve declared column order;
native collection cards show the first three fields and put remaining fields
beside supplied row details. Fact entries disclose their fields on selection.
Report teasers disclose remaining text and references; shortened teasers retain
their complete source in detail. Entries with no additional context explain that
fact instead of opening a duplicate detail panel. Full record expansion retains
all supplied fields. Automatic call detail explains the observed lifecycle and
shows a readable UTC observation time and known cause; reviewed slot and original
operation identity belong to explicit expansion. No command, result, duration or
domain verdict is invented from call metadata.

Navigation, headings, declared labels, typed values, measured counts and host
states have distinct foreground roles. Active calls use an accent, returned calls
remain secondary, failed calls use red and uncertain/cancel-requested calls use
amber, with explicit state words retained. Returned calls never receive a green
application-success verdict. Escaped recorded values may use lexical syntax
colors without interpreting their words as status or commands. Color-free
presentation preserves every distinction through wording and hierarchy. Large
empty panes must not exhaust the encoded frame budget or hide exit controls;
actual content overflow still discloses clipping.

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
filter, reference selection, attention, preview or detail before leaving. Live q,
standalone Escape or input EOF
restores input and continues inline, without re-entering later. Live Ctrl-C uses
existing cancellation and cleanup. After all execution, cleanup and delivery
settle, an inspector still open shows literal settled facts and read-only results;
if the operator has not navigated, it selects the root publisher's landing view
or first retained root view and its first row when present.
q/Escape/Ctrl-C then closes presentation without changing admitted outcome.
No Flow or channel remains alive for inspection. Inspection has no built-in idle
or absolute expiry; it remains open until the operator leaves, input/output fails
or an external interruption closes it. Explicit inherited enclosing command
constraints still apply, and no input or repaint extends them. Eligible interactive
effective dashboard commands omit the default enclosing presentation lifetime,
while setup, Run execution, cancellation and cleanup keep their own bounds.
Execution elapsed time freezes at settlement. An expiring explicit presentation
constraint leaves live execution running through its ordinary owner; it never
extends an execution timer. Immutable delivery inspection is selected before
capture/publication even though screen entry waits for dispatch. Every exit releases preview,
input and presentation owners. Auto/plain emit the latest retained summaries
with ended/incomplete context and exit promptly.

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
   bounded inline dashboard above. Explicit dashboard retains stages inside its
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
   explicitly selected eligible dashboard with NO_COLOR uses screen controls
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

Without an entrypoint, interactive `jig run` presents numbered approved targets
and their retained descriptions before execution acquisition. Empty input
cancels; noninteractive invocation requires an exact target. Selection does not
approve visible edits or bypass Run validation. Approval changing between
selection and submission refuses the invocation with `RUN_APPROVAL_CHANGED`.

`jig completion bash|zsh|fish` prints shell integration. Its dynamic
`jig completion targets [prefix]` lookup reads only approved selectors, without
environment checks, source evaluation, state writes, or provider requests.
It emits one selector per line; unavailable state yields no suggestions.

Human inspection supplies invocation guidance from the retained interface:
required fields, file placeholders, and channel requirements. Input examples
are explicitly templates, not invented schema-valid domain data. Required
incoming channels are identified as needing a Flow caller, not a runnable CLI
example. Machine inspection includes the optional approved `entrypoint` string.

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

After interruption, the command waits for owned cleanup and emits its observed
authoritative terminal when available, with `command: {status: 'interrupted'}`
and exit 2. Execution status remains unchanged if completion won the race.
Cleanup failure is reported separately. A missing terminal, coordinator loss,
or broken output stream cannot be replaced with a fabricated terminal; consumers
must still handle incomplete output. No reporting path replays execution.
With `--out`, confirmed settlement after interruption may publish the terminal
record and an already accepted checkpoint. It never exports unfinished final
Flow files. The trusted command's bounded settlement wait does not extend the
Run deadline; forced termination still leaves unavailable evidence unavailable.

### Agent project initialization

`jig init <directory> --agent codex|claude|pi` optionally authors a declared
Agent dependency, `bindings/agent.ts` with its native grant, and a contract-keyed
default in `jig.ts`. Bare `--agent` asks for an explicit choice on a terminal;
empty input cancels. Noninteractive use requires the client argument. Selection
does not inspect or install a client, copy authentication, resolve dependencies,
or approve authority. `--bare` omits the greeting, not the explicitly requested
Agent configuration. Existing destinations are never overwritten.

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

`jig inspect --result <directory> [--display plain|dashboard] [--json]` reads a
saved packet without loading a project, verifying an execution installation,
reading operator configuration or credentials, acquiring execution authority,
or contacting a provider. It rejects target and verification arguments. Plain
is the default; JSON or redirected stdout takes precedence over dashboard.
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
immutable captures, with at most one 64 KiB UTF-8 preview; they never reopen a
mutable path. One owner releases descriptors and captured buffers on every exit.
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

The CLI's shared presentation and progress modules own human formatting;
command branches supply facts. Installed-launcher errors follow the same
hierarchy even when the application cannot start. Review policy is generated
from the same captured records that are approved, and human Run summaries
come from the same terminal observations as machine results.

Changes to public output must update this contract when its guarantees change,
its owning implementation, and focused acceptance tests together. Adding an
ad hoc raw diagnostic or weakening an assertion to accommodate unreadable
output is not an acceptable shortcut. Recovery advice remains subject to the
[results guide](../guide/results.md) and exact lifecycle contracts.

# CLI experience contract

Jig's CLI serves **agency through power under control**. People must be able
to understand the task, observe progress, interpret the outcome, and take the
next safe action without a maintainer translating internal machinery.
This specification governs every public Jig command, help screen, approval,
notice, diagnostic, progress display, and installed-launcher failure. It
makes usable control an observable requirement;
[project policy](project-policy.md) retains authority over admission and lifecycle.

## Required experience

`jig import-contract <descriptor.json> <new-directory>` is explicit offline
authoring. It captures and validates one invocation descriptor and its exact
channel closure (at most 64 agreements, 256 KiB per file, 1 MiB captured bytes),
preserves bytes and relative paths, and publishes only to an absent destination
whose parent already exists. It may resolve the operator-selected source root
through an installed-package link; it rejects links within the selected closure.
It does not evaluate package code, fetch dependencies, acquire execution
authority or approve a Run. Cancellation before publication leaves no destination;
completed publication is not undone. Process loss may leave an unpublished
`.jig-contract-*` staging directory, not a successfully imported bundle.

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
   Interactive terminal stderr has one active line with
   elapsed time. Preserve completed stages; never mark a failed or merely
   departed stage complete. Update waiting time in place, not by appending
   unchanged messages. Report the known wait reason; never invent percentages,
   estimated completion times, or internal Flow stages. Finish or suspend the
   active line before prompts, notices, streamed diagnostics, or results.
3. **Consistent visual hierarchy.** Use bold task/section headings and final
   outcomes, green completion, amber warnings, and red failures. Text must
   carry every meaning independently of color or symbols. Use foreground colors
   without background fills; provide syntax palettes for light and dark terminals.
   Narrow terminals must retain complete consent and recovery information;
   only the transient progress label may shorten to fit. Separate major terminal
   sections with a blank line, a restrained horizontal rule, and a bold heading;
   keep individual records and their fields grouped beneath that heading. Plain
   terminal mode preserves these boundaries without escape sequences.
   Use the terminal's gray for secondary metadata: hashes, diagnostic codes,
   categories, change counts, completed-stage text, elapsed time, and optional
   detail notes, executable paths, and unchanged context. Changed-record labels,
   including their identifiers, use bold amber to draw attention to changed work.
   Omit review categories with no changes from the ordinary summary.
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
5. **Useful next actions.** Successful setup and review identify the next
   supported action. Failures give a verified command, specific correction, or
   relevant documentation when available. Never invent commands or recommend
   bypassing safeguards. Commands containing user values must be shell-safe.
6. **Explicit authority.** Show consequential permission scope before effects.
   A supplied grant is acknowledged, not requested again. Dependency resolution
   notices retain public/private-network access, pre-validation effects,
   irreversibility, possible rejection, and review-only scope. Approval shows
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
   selection and explain what approval authorizes. State when source, dependencies,
   settings and permissions are unchanged. A combined environment fingerprint does
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
   arbitrary application output afterward; field names never establish success.
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
   and `TERM=dumb` select plain presentation without animation. Plain terminal
   progress reports stage changes once. Do not require Unicode, a pager, cursor
   hiding, an alternate screen, or interactivity. Escape untrusted control and
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

Interactive `jig run` without a target presents numbered approved targets and
their retained descriptions before execution acquisition. Empty input cancels;
there is no default target. Noninteractive invocation requires an exact target.
Selection does not approve visible edits or bypass Run validation.

`jig completion bash|zsh|fish` prints shell integration. Its dynamic
`jig completion targets [prefix]` lookup reads only approved selectors, without
environment checks, source evaluation, state writes, or provider requests.
It emits one selector per line; unavailable state yields no suggestions.

Human inspection supplies invocation guidance from the retained interface:
required fields, file placeholders, and channel requirements. Input examples
are explicitly templates, not invented schema-valid domain data. Required
incoming channels are identified as needing a Flow caller, not a runnable CLI
example. Machine inspection retains its existing JSON contract.

`jig new <name>` creates `flows/<name>` in the current project, never overwriting
an existing path. It does not evaluate `jig.ts`, install dependencies, modify
membership, or approve the new Flow. The SDK dependency follows the project's
explicit package manifest declaration when present, otherwise the tested SDK.
Explicit membership arrays must be edited by the author before review.
## Diagnostic evidence and interruption

Configuration-evaluator refusals retain the captured declaration location and
a closed diagnostic distinguishing installation support, containment launch,
envelope validation, cleanup, interruption and protocol response. Human guidance
explains the known phase and next safe action; it MUST NOT expose launcher
exceptions or infer a particular host or timeout cause from generic launch
failure. These planning diagnostics establish that no Flow was started.

Run reports retain optional `runDiagnostics`: `entries` contain the host-assigned
`operations` call path (empty for the root), `stderr`, `stderrBytes` and
`stderrTruncated`; `truncated` marks any lost diagnostic evidence. Retention is
bounded to 64 KiB across 32 emitting invocation paths. These are untrusted
diagnostic bytes, not application results. The existing terminal `diagnostics`
continues to describe root-process stderr only. Live rendering escapes control
characters and identifies changes of emitting invocation.
Human final results summarize diagnostic text already delivered for that invocation,
retain any unseen suffix, and disclose capture truncation. Interleaved invocation
paths are tracked separately. JSON records and result packets retain their complete
bounded captures independently of this presentation.

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

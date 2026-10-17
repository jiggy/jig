# Jig command presentation and inspection

Apply these rules when the [package reading map](AGENTS.md) selects this domain.
The package entrypoint retains shared requirements and child ownership.

## Find a module or task

All selected domain requirements still apply.

| Work | Required details |
| --- | --- |
| Application client or machine request framing | [Installed-host client](#installed-host-client) |
| Discovery, completion, or caller creation | [CLI discovery](#src-cli-discovery) |
| Grammar, acquisition, or review readiness | [Command grammar and review](#command-grammar-and-review) |
| Inspect approved targets | [Approved target inspection](#approved-target-inspection) |
| Select installation verification | [Installation verification](#installation-verification) |
| Change presentation, progress, or reporting | [Shared presentation](#shared-presentation) |
| Verify observable output | [Verification](#verification), [acceptance checks](#acceptance-checks) |

## Local Contracts

### Installed-host client

- `src/client.ts` and pure `src/attempt-contract.ts` own the separate
  installed-host application client. Importing it starts no process and grants no authority.
  It uses the installed machine boundary, never embedded native internals or private-state reads.

  `src/cli-attempt-io.ts` bounds machine requests without consuming the owning submit connection.
  Request completion differs from client closure. Duplicate observers never inherit cancellation ownership.
  Keep execution, retained-byte availability, export and retirement facts distinct in machine and human output.

### src cli-discovery

- `src/cli-discovery.ts` owns invocation guidance and shell completion.
  Completion and the interactive target chooser read approval only, without
  environment probes or source evaluation. Approved project entrypoint selection
  precedes acquisition. Run still performs all ordinary authority checks.
  `jig new` writes ordinary Flow source without overwriting, evaluating,
  installing, or approving it. Optional `--use slot=source` snapshots selected
  offline contract closures and writes portable slot references.

  It does not infer providers, grants, library dependencies or workflow logic.
  Stage complete source outside ordinary Flow discovery before non-replacing
  publication.

### Command grammar and review

- Command help and syntax errors do not acquire execution authority. Review
  leads with complete changed policy. `--details` includes unchanged policy. Run
  stdout is readable on terminals. Redirection or `--json` selects exact
  JSON/NDJSON. Elapsed status uses terminal stderr only.

  An unreviewed ordinary Run reports `ADMISSION_MISSING`, not a changed approval.
  A supplied approval pin keeps its separate stale-selection checks.
  Never imply earlier consent when no revision was approved.

  Cancellation requested and cleanup confirmed are separate facts. Acquisition
  reports Jig runtime verification, operator resource configuration, and
  project-state recovery separately. Capturing configuration does not verify a
  native client. Only targets selecting an ACP grant trigger that verification.
  SDK expected trusted setup refusals retain unavailable exact targets and their
  selected dependents. Unrelated targets keep their own readiness.

  CLI review stops any observed typed selected ACP prerequisite before avoidable
  target execution preparation, unchanged success or apply. Its readiness
  callback throws one fixed private typed refusal. Only that exact marker
  receives setup rendering. Arbitrary integrity, I/O, cancellation and cleanup
  faults retain their own failure, never classification from display codes or
  truncated issue rows. Inspection discloses retained availability separately
  from environment freshness. Chooser selects ready routes only.

  Installing a client requires renewed review before an unavailable retained
  route can run. Review also separates source capture, per-package dependency
  capture, preparation/reuse and review retention, with stage-local timing.
  Prepared workspace artifact reuse stays within the approving Jig project.
  Configuration-evaluator memory, process and wall-clock refusals retain their
  distinct verified codes, including a host-observed deadline during envelope
  preparation. Generic limits do not imply host pressure. Arbitrary launch codes
  cannot establish a deadline.

### Approved target inspection

- `inspect` compares the last local approval with current local execution
  identities, including selected children. Report mismatches as review required
  and unverifiable comparisons as unchecked. It does not evaluate source,
  acquire execution authority, resolve dependencies, contact providers, recover
  or write state. Credential reads stay private. Matching identities do not
  establish source freshness, launch readiness or remote availability. Approved
  effective ACP policy and optional retained `agentOverride` identify
  review-argument origin without live-source inference or a later review
  default.

  Schema type diagnostics retain only closed expected/received JSON types, not
  rejected values. Human Run output leads with host facts before arbitrary
  results.

### Installation verification

- `run`, `review`, and `inspect` expose `--verification cached|strict|fast`.
  Precedence is argument, then `JIG_VERIFICATION`, then cached. Validate with
  each command grammar before acquisition, and preserve the choice on
  reexecution. This is captured operator policy, never project-controlled. Keep
  help, the configuration reference, security statement and execution policy
  aligned. Describe the weaker freshness guarantee of fast mode explicitly.

  Cache only installed support, never approval, retained package or invocation
  authority.

## Work Guidance

### Shared presentation

- Before any public CLI output change, read and apply
  [the CLI experience contract](../../docs/jig/spec/cli-experience.md).
  `src/cli-presentation.ts` and `src/cli-progress.ts` own shared human
  presentation. `src/cli-reporting.ts` owns scoped Flow activity state and
  untrusted attributed notices within that presenter. Stopping and terminal host
  states fence repaint callbacks. Accepted complete notices retain order. The
  automatic profile uses one separate command-only broker allocation, preserving
  ordinary application channel quotas.

  Launcher failures follow the same structure. Never introduce a separate raw
  diagnostic style or route machine output through styling. Shell completion
  must work with macOS's system Bash 3.2 without installing another shell.
  Collect replies with portable array/read operations. Major terminal sections
  need visible boundaries. Secondary metadata uses gray while consent, policy
  values, and recovery actions remain prominent.

  Suggested actions use standalone `$ jig ...` commands. Help and host command
  references omit Markdown backticks. Command names, flags, placeholders and
  argument literals use distinct syntax accents. Preserve quoting and never wrap
  commands. Application data bypasses recognition. Before any confirmation or
  answer prompt, pause progress and await its queued output, then check
  cancellation.

  The question and answer share one line without intervening stages or notices.
  Readiness status words carry green/amber emphasis without claiming execution.
  Noninteractive auto inline uses a compact
  root-summary/actual-branches/current-activity projection with attention first
  and visible overflow. Plain selects root landing or first retained root
  summary once and prints a changed summary at settlement, preserving
  ended/incomplete context rather than replaying every view. In auto/plain,
  activity phase changes append separate attributed indented lines. Only host
  waiting owns a transient line.

  Clear events silently retire their slots. Printed phases remain history, and
  application notices own job outcomes. Complete notices have one
  Flow-attributed first line and indented continuation lines. Escape every
  payload line without recognizing it as host prose. Effective TUI owns one
  alternate screen after trusted root execution admission, keeping initial
  input/review/runtime refusals in ordinary output, retaining typed
  host/Flow/diagnostic entries inside bounded Activity. Fixed shell, responsive
  meaningful context, dense aligned collection rows and expanded evidence serve
  progressive disclosure.

  Newest-first Activity with expandable setup, actual collapsible Execution and
  contextual keys also serve it. These features use no terminal author
  callbacks. Attention remains attributed and reachable from every view.
  Diagnostic reports have a separate literal panel. Unknown severity stays
  unknown. Freeze execution elapsed at settlement.

  Select the root landing or first root view only when the operator has not
  navigated. Never project settled host facts as current work. Authored detail
  prose wraps at complete grapheme/word boundaries. File preview wrapping keeps
  its existing literal path. Style each pane independently so list focus or
  headings cannot color unrelated detail text. Charge composed SGR to the same
  encoded frame ceiling.

  Restore the original screen and commit complete retained essential causes
  before final stdout. No ordinary notice or repeated view-summary spill while
  that workspace is open. Explicit notice severity is Flow-reported importance,
  never host outcome or guaranteed delivery. A heading must never have less
  emphasis than its subordinate details. Expanded unavailable-client labels use
  bold amber above normal-contrast setup instructions. The compact names-only
  unavailable summary remains secondary.

  Unchanged source, prepared-file and dependency-layout reassurance belongs only
  in `--details`. Keep the changed fact, environment uncertainty and approval
  consequence visible in compact reviews. Omit repeated ACP selections only
  after proving unchanged runtime identity under identical recipient routes.
  Unknown comparisons remain visible, and details always show selections. An
  explicit review client operand retains its authored/effective selection
  summary even for same-client or unchanged review. Dim executable paths and
  unchanged context.

  Omit review categories with no changes from the ordinary summary.
  Changed-record labels and their identifiers use bold amber: they identify work
  requiring attention, not secondary metadata. `src/cli-value-presentation.ts`
  uses the existing YAML serializer for human values in reviews, inspection, Run
  results, and structured channel messages. Do not rebuild a custom
  type-labelled tree. Preserve exact types, safe quoted keys, controls and
  block-string whitespace through syntax highlighting and `JIG_THEME` palettes.
  Never style or reserialize machine records.

  Review uses contextual field diffs. Identity-only target changes need a
  concrete explanation of the changed execution environment or prepared files,
  unchanged policy, and approval consequence. Do not show identical
  previous/proposed blocks or an unexplained "retained identity" label.
  `--details` adds unchanged context to the same sectioned diff, never a YAML
  dump of change bookkeeping or current/proposed snapshots. Ignore object
  insertion order when comparing review records. Preserve array order.
  `cli-run-presentation.ts`

  owns human Run results and channel streaming. Join text fragments exactly,
  label channel switches and endings, escape controls, and preserve separate
  execution, application, delivery, and cleanup outcomes. Count invocation paths
  whose diagnostics were already shown live. Do not replay them or create a
  result section for the count alone. Preserve path-specific unseen suffixes and
  truncation. Machine records retain the full bounded capture.

  A generic failure without diagnostics must state the missing evidence. Do not
  imply that the Flow never started or repeat an identical raw error block.
  Generic human failure summaries must retain specific terminal failure
  messages. Hiding the structured result's message must never discard its cause.
  Quote and escape reported text as data, and do not infer missing evidence from
  empty stderr when the terminal already carries a specific explanation. Schema
  authoring failures identify the required root dialect when known and route
  unsupported keywords, references and limits to FLOW Schema/0.

  Never display rejected schema values or compiler exception text. Render
  host-only REVIEW_REQUIRED with `jig review` as the next action. Flow-supplied
  error details cannot establish that execution never started. Emphasize host
  failure/uncertainty in summary status lines and end failed Runs with the cause
  and next action after evidence. Omit packet provenance manifests from human
  results. Retain full machine and packet records.

  A confirmed written packet permits compact success output. Show small
  application answers. Alongside large nested evidence, retain at most eight
  complete top-level scalar fields within 2048 JSON characters. Do not assign
  meaning to field names. Identify that brief view and point to `result.json`
  for full output and checkpoint evidence, and show the nonzero delivered file
  count. Omit null checkpoints from human results.

  Uncertain delivery keeps evidence visible. Input errors name the approved
  schema without guessing source freshness. Emit the dependency network notice
  once per review before preparation, retaining package progress.

## Verification

Run presentation retains one admitted observation accumulator and one bounded
stderr writer. `src/cli-display-projection.ts` adapts accepted host facts into
readonly snapshots from `@jigging/display-model`. `src/cli-recorded-role.ts`
assigns reserved recorded roles only at the host adapter. Publisher/call
correspondence, opaque display identities, transcript receipt accounting and
immutable captured excerpt access stay private to Jig. Authored names never
choose host status or roles.

`@jigging/display-web` owns browser rendering, client generations, navigation
and fixed self-contained assets. `src/cli-web.ts` retains loopback HTTP, bearer
capabilities, CSP, transport bounds and presentation lifetime. Read the current
`docs/jig/spec/web-display.md` before changing this boundary. Prepare without
advertising before admission, join trusted-dispatch activation and keep
capability publication outside journals/diagnostics. Machine precedence decides
before listener preparation. Import fixed asset bytes through the package's
declared asset export and bundle them into installed CLI identity.

Web must not initialize native TUI support or read checkout-relative assets.
Browser fetches keep memory-only authorization, exact authority/origin checks
and inert text. Failed projection retains its independent reserve. Stale bodies
disable references while current causes and Close remain available.

After a known terminal and confirmed project closure, every display mode retires
delivery authority under one finite completion end, preserving the presentation
minimum. Dashboards transfer receipt-selected excerpts first. Plain/JSON retires
directly. Close local captures before command success or indefinite inspection.
Unknown execution or failed project closure retains original source-exit
recovery. Local closure uses only the existing presentation end.

Preserve the first finalization promise, its deadline and failure, known
execution/delivery and the primary error. Installed lifecycle suites must exercise
actual delivery and interruption. Pure policy checks do not qualify authenticated
retirement or native cleanup. Initiate forced native connection cancellation before
discarding response queues and join it after disposing subscriptions and
buffers. Blocked-stream expiry retains admission until abort/cancel
acknowledgement. Closing inspection releases preview waiters.

Late bytes cannot restore it.

`@jigging/display-tui` owns private viewer state, key/escape decoding,
responsive panes, inline rendering and bounded terminal frames. Jig imports its
public `prepareTui`/`createTui`/`createInlineDisplay` surface.
`src/cli-tui-input.ts` and `src/cli-progress.ts` retain real input, signals,
screen restoration, the single output writer, command constraints and
phase-aware interruption decisions. Core and Tree-sitter remain required exact
external runtime dependencies. Only eligible TUI preparation loads native
support before execution. Automatic selection falls back on unavailable support.

Explicit TUI maps it to `JIG_TUI_UNAVAILABLE`. Frames and escaped attention
representations remain charged to existing byte ceilings. Package DTOs never
carry the admitted host model or execution powers.

`--display` is operator-only. Auto selects TUI only with suitable terminal
input, stdout and stderr. Ordinary fallback borrows no input. Effective TUI owns
and restores raw/flowing stdin. Inspection has no local idle or absolute expiry.
q, keyboard Ctrl-D and settled keyboard Ctrl-C request exit confirmation with
Stay selected.

Contextual Escape returns within the TUI and stays at the top level.
Input/output loss and external interruption still close and restore it. Explicit
inherited presentation constraints remain a minimum across enclosing owners,
with a 45-second closing reserve for finite command timers. Only eligible
effective `tui` or `web` omits the default file/delegation command envelope.
Machine modes and setup/cleanup owners retain their bounds. Run timeouts and
explicit enforcement timers stay unchanged.

Trusted root admission starts screen entry and the CLI joins it before
settlement. Early host stages, call observations and diagnostics remain visible.
Post-settlement inspection owns no execution/channel lifetime.

Select immutable delivery capture before publication. Preview suppliers receive
only artifact identity and capture generation, never mutable destinations or
arbitrary paths. Navigation is renderer-local and cannot mutate host
observations. `image-preview-policy.ts` owns bounded raster preview data. The
bundled image worker and pinned renderer/font bytes participate in installed
support identity. Production file-image decoding remains unavailable until
independent fencing can interrupt Wasm on the qualified Bun profiles.

Text and saved-file access remain usable. Auto/plain commit complete essential
causes outside redraw. Entered TUI restores the screen, then commits retained
causes in awaited bounded batches before final stdout, without replaying view
summaries. Output disconnection retains the Run's existing cancellation owner.

Renderer/model navigation, hierarchy, preview fencing and maximum-view checks
belong to their package suites. See their owning `AGENTS.md` files. Jig's
`test/portable/dashboard.test.ts`, `test/portable/cli-tui-input.test.ts`,
`test/portable/workspace-progress.test.ts`,
`test/portable/cli-display-observations.test.ts`,
`test/portable/cli-web*.test.ts` and installed tests retain host admission,
attribution, receipt, transport, lifetime, terminal restoration, JSON and
immutable-capture proof. Frozen standalone package consumers and frozen
installed Jig runs are distinct gates.

Never use source mocks or private replacement evidence.
Design approval qualifies neither installed behavior nor newcomer usability.
`test/portable/cli-review-agent-setup.test.ts` and
`test/portable/project-resource-qualification.test.ts` check bounded read-only
setup facts, shared recipients, preserved policy, honest captured locations and
authoritative refusal despite report omission.

CLI checks refusal before avoidable target execution preparation, unchanged
success and apply, with prior approval/source preserved. Linking/capture and
lock tests cover the explicit review operand, all-selected-ACP rules, exact
identity and retained origin. Ordinary authority, generation and cleanup checks
remain independent. `inspect --result` bypasses project/environment acquisition
and reads only the selected descriptor-confined packet. Its fixed views label
all evidence recorded, never reconstruct live views or authority, and preserve
exact decoded JSON. Qualify partial file capture, framing/byte/path limits, link
refusal, interruption, buffer release and output failure independently of
recorded execution status.

Both source and installed record writers await bounded output completion.
An unwritable output descriptor cannot produce a successful inspection exit.

### Acceptance checks

- CLI acceptance:
  `bun test packages/jig/test/portable/cli.test.ts packages/jig/test/portable/cli-presentation.test.ts packages/jig/test/portable/cli-run-presentation.test.ts packages/jig/test/portable/cli-value-presentation.test.ts packages/jig/test/portable/cli-output.test.ts packages/jig/test/portable/project-plan-review.test.ts`.
  Check rendered success, failure, waits, cancellation, uncertain cleanup,
  plain/redirected output, narrow widths, and light/dark terminal palettes.
  Preserve byte-exact machine records and complete changed review policy.

- Test diagnostic usefulness as well as redaction, and human-facing output
  alongside its machine-readable contract.

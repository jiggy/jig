---
title: Run a small software factory
---

# Run a small software factory

Turn a fixed set of one or two authorized issues into separate tested patch
packets. A reusable Semantic Router selects a reviewed repair configuration from
the issue and its work preferences, or abstains. Each factory-owned worker reproduces
the defect, requests bounded source replacements, executes reviewed commands, and
checks unchanged acceptance cases. You still decide whether any patch should be
combined, merged, or released.

Use the [small software factory source](https://github.com/jiggy/jig/tree/main/examples/software-factory).
This is an implemented, self-contained source application. Its local repair Flow
and Semantic Router use ordinary workspace dependencies. Its external Agent and
FLOW dependencies are published alphas. The live comparison below used a fresh
maintainer-authored copy, public dependencies, and the source Jig host. It does
not establish an installed npm Jig run or independent consumer adoption.

## Run the supplied batch

In a copy of the example, run `bun install`, inspect `batch.json`, the Agent,
single-pass and checked-correction Bindings, and the two named case files. The supplied Binding selects native
Codex through ACP. To use an HTTP Agent method instead, follow the package and
Binding setup in [Reuse the Agent method](agent-method.md#invoke-the-ordinary-flow),
including its optional [OpenAI-compatible gateway route](agent-method.md#use-an-openai-compatible-gateway).
Then authenticate the selected Agent:

```sh
jig review --allow-resolution-network
jig run
```

The reviewed `entrypoint` in `jig.ts` selects the factory, `batch.json`, the
`fixtures` source tree, an eight-minute deadline, and `factory-result` for output.
For another batch or a repeat Run, override the input and choose a new output:

```sh
jig run --input @batch.json --out factory-result-2
```

Existing results are never overwritten. Explicitly naming a target bypasses
entrypoint defaults; supply that invocation's arguments in full.

Add `--receive progress --json` to observe each job's method selection and the
repair specialist's baseline, proposal, check, and finish phases. The broadcast
channel does not wait for a reader to accept each message. A `settled` notice
follows the job's durable checkpoint. These messages show activity only; the
final result and retained evidence determine whether a patch is review-ready.
The factory's `checkpoint` slot separately retains settled job evidence across
interruption.

The factory accepts at most two jobs. It validates and captures every selected
project and case set before starting paid work, then routes and repairs each job
independently. One configuration allows a single checked proposal; the other
allows one correction using check feedback. Both require the same evidence. Original projects are
read-only; only a new result packet is writable. Source reads use explicit file
offsets and must match their observed sizes; an incomplete or wholly empty
materialization stops before worker dispatch.

## Review the packet

Start with `factory-result/files/summary.txt`, then inspect each job directory
and the host-owned `result.json`.

- `review.patch` means that job reproduced its defect and the final candidate
  passed its repository test command and every independent case.
- `proposal-N.patch` preserves a valid unsuccessful proposal without calling it
  review-ready.
- A failed or cancelled peer stays explicit. It does not erase a healthy job's
  patch or manufacture a verdict for unfinished work.
- Checkpoint evidence contains only settled jobs. After interruption, the host
  can deliver that accepted checkpoint with the unsuccessful Run status.

Patches are checked separately. The factory reports overlap and blocks
conflicting replacements, but it does not claim that two individually passing
patches pass when combined. Apply selected patches to a disposable copy, run
combined checks, and review the changes before a human merge decision.

## Adapt the issue set

Place each small project beneath the directory supplied as `source`. The
included specialist runs the same `test/project.test.ts` and `src/cli.ts` paths
for both projects; change its Binding only when your bounded application needs a
different common command shape.

For each job:

1. add a named `*-cases.json` beside `flows/factory/FLOW.ts`;
2. add its `id`, relative `directory`, case-set name, issue text, and existing
   editable `src/*.ts` or `src/*.js` paths to `batch.json`;
3. reproduce the failure yourself; and
4. review again before starting the batch.

Do not move acceptance policy into candidate source or relax it after seeing a
proposal. Optional `cancelAfterMs` covers the entire routing-and-repair interval of
one job while its peer may finish; root cancellation still stops all owned work.

## Choose a method without changing its authority

The supplied issues express different work preferences: the log repair gets one
proposal, while the timesheet repair can use check feedback for a correction.
The supplied `batch.json` leaves `method` unset, so an ordinary `jig run`
exercises the Semantic Router for both jobs. Inspect `routing` in the result
packet to see its actual choices; these are judgments, not guaranteed routes.
`flows/factory/methods.ts` supplies opaque IDs and descriptions and maps them to
reviewed slots. A second proposal is a work budget choice, not weaker acceptance.
With no preference, the candidate data describes checked correction as the
default; the router prompt asks the Agent to apply that default only when the
method suits the stated requirements. This remains model judgment, not a
deterministic guarantee.
When the operator already knows which configuration to select, set that job's
`method` to `p1` or `p2`; this exact reviewed choice bypasses the router. Omit
`method` to ask the router to judge from the issue and preferences. Both paths
still use the same worker and acceptance checks. The router is useful when the
preference is expressed in the task text; it is not a cheaper or more reliable
replacement for an explicit choice.

For example, a job may include `"method": "p1"` to require one proposal, or
`"method": "p2"` to allow a checked correction. Unknown method IDs fail input
validation before any Agent call. The final and checkpoint evidence records
whether the choice was explicit or automatic and the exact selected slot.

The [Semantic Router source package](https://github.com/jiggy/jig/tree/main/examples/software-factory/flows/router)
is independently reusable. It accepts only task text and a bounded candidate list,
uses the ordinary Agent contract, and returns a supplied ID with a reason or null
for abstention. Candidate IDs and descriptions are data, not executable selectors.
It has no host registry, provider configuration, or factory-specific prompt.
Candidate descriptions are still natural-language model input: use reviewed
application-owned descriptions, and do not treat membership validation as
protection against instruction-like text or as an authority check.

The factory validates even a replacement router's complete result and membership
before calling the mapped slot. Abstention, Agent blocked/limit, malformed output
and operational failure produce no worker dispatch or patch for that job. They
remain visible alongside healthy peers. Job evidence retains the exact routing
input, validated decision and selected slot; checkpoint and final summaries show
the routing outcome. The router returns before the worker starts, keeping each
concurrent branch within the ordinary host budget.

Adding an eligible method changes candidate data and the factory's declared slot
and Binding. Keep any input/result adaptation in application code and preserve
independent patch inspection. Reusing the router for a different domain changes
only candidate data and project wiring. This is bounded semantic dispatch, not
catalogue discovery or installation. Membership checks enforce the finite set;
they cannot guarantee an appropriate choice within it.

## Bounded live source evidence

On 2026-09-24, the current router instructions were evaluated on eleven frozen,
synthetic held-out cases through an ordinary Jig Run in a fresh consumer project,
using `mistralai/mistral-small-2603`. Seven choices matched the pre-recorded
expectations. Four did not: the Agent selected a sole candidate despite an
explicit mismatch, selected the default when task context was missing, treated
contradictory mandatory budgets as conditional, and followed instruction-like
text embedded in one candidate description over the task. All eleven Runs
completed successfully at the protocol level; that does not make the four
judgments correct. The result is not evidence of improved suitability or
abstention, and it exposes that candidate text can steer the Agent. The router
therefore remains a bounded choice mechanism, not a suitability, injection
resistance, permission, or policy boundary. Supply reviewed application-owned
candidate descriptions and independently validate dispatch policy.

This is a small maintainer-authored synthetic set, not a general accuracy
estimate. Cases, prompt and host hashes, per-Run outputs, and the full method are
retained in the repository's transient `.tmp/semantic-router/revised-holdout/`
record; do not tune against this set and then reuse it as held-out evidence.

An earlier evaluation of the previous router instructions used a different
frozen set, so its outcomes below are not directly comparable to the current
run.

In a fresh copy with an operator-selected OpenRouter Mistral BYOK Agent, twelve
frozen direct router Runs tested repair preferences, abstention, adversarial text,
and an unrelated prose-method set. With `mistralai/mistral-small-2603`, ten of
twelve choices matched the expected sets. It selected a repair method instead
of abstaining on an underspecified request and on contradictory mandatory
preferences. A lighter `mistralai/ministral-8b-2512` run matched nine of twelve,
also missing the no-preference default. All twenty-four Runs settled; this
small synthetic set is evidence of behavior, not a general accuracy estimate.

The same source factory then routed the supplied two issues to different reviewed
configurations. Both workers reproduced their defects, passed their fixed Bun
tests and every independent case after one proposal, and delivered separate
review patches. A fixed two-proposal baseline on the same inputs also completed
both patches. Approximate command wall time was 128 seconds routed versus 96
seconds fixed; this trial demonstrates method selection and evidence retention,
not a completion or speed advantage. Original fixture bytes were unchanged,
and both root Runs retained confirmed fencing and release. The provider did not
expose per-call cost through these Jig results, so no factory cost comparison is
claimed.

## Earlier factory evidence

The following comparison predates semantic dispatch and does not measure routing.


On the supplied two-project candidate run, one native Agent request failed while
the other worker produced a patch passing two repository tests and four
independent cases. The batch returned `blocked`, exported only the healthy patch,
retained both outcomes and a checkpoint, and left all source bytes unchanged.

A frozen comparison used Codex 0.154.0 with its default model selection. The
factory needed one batch command but accepted one of two issues in about 75
seconds. A direct Codex coding session edited disposable copies and accepted
both issues in about 169 seconds; it also had to construct its evidence harness,
whose first invocation failed before being corrected. Counting the operator's
mistyped CLI submission gives one action versus two, but excluding that unrelated
mistake makes the primary action metric a tie. This run therefore does not prove
a coordination advantage or superior patch quality. It does demonstrate the
factory's predefined evidence shape and healthy-peer retention under a real
failure. The earlier two-fixture controller comparison also remains a tie.

An independent builder then replaced the issue set with invoice-total and
word-frequency projects without changing the Bindings. It reproduced both
defects, reviewed three exact grants, and completed one bounded batch in 121
seconds. The invoice Agent failed before proposing a patch. More importantly,
the word-frequency child saw empty files even though the host's captured input
manifest retained all 24 nonempty source identities. No patch was called ready,
all originals remained byte-identical, and nothing was merged.

At that stage, the source correction verified every projected attachment's
byte count and digest in Jig's trusted inner launcher before Flow code started;
the repair input layer also rejected incomplete and wholly empty reads. Replaying
the same adapted input failed before any worker or Agent call. A separate 24-file
nested host projection check passed, so that evidence alone did not establish
the cause of the projection mismatch.

## Published package evidence and adoption limits

This example remains limited to small Bun projects and one or two preselected
issues with a human merge gate. The published `@jigging/jig@0.1.0-alpha.22`
contains the corrected captured-input projection used by the example.

An independent builder used that published package and this guide to repair
one issue in each of two other Bun projects; both patches passed repository
commands and independent acceptance cases. This is preliminary evidence, not
the current adoption criterion. A later same-project, two-issue attempt
reproduced both defects, but the configured Agent endpoint rejected both calls
before proposals, so no patch or repair-quality evidence resulted. Adoption
remains unproved until an independent builder produces at least one review-ready
patch with passing repository and independent checks, retains inspectable
outcomes for the other issue, and can explain how to review the results. These
runs were not technically isolated clean-room tests and establish neither
general model reliability nor an advantage over a capable coding Agent.

Immediate follow-up interruption also remains unqualified with a supported
native client on Ubuntu using published packages. Deterministic tests and the
documented requirement to await the same turn's result do not replace that live
qualification.

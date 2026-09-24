---
title: Run a small software factory
---

# Run a small software factory

Turn a fixed set of one or two authorized issues into separate tested patch
packets. A reusable Semantic Router selects a reviewed repair configuration from
the issue and its work preferences, or abstains. Each worker uses the [tested-patch method](./tested-patch.md): reproduce
the defect, request bounded source replacements, execute reviewed commands, and
check unchanged acceptance cases. You still decide whether any patch should be
combined, merged, or released.

Use the [small software factory source](https://github.com/jiggy/jig/tree/main/examples/software-factory).
This is an implemented source application. It reuses the sibling tested-patch
repair Flow through an ordinary local workspace dependency, so its own setup
still follows the repository workspace instructions. Its external Agent and
FLOW dependencies are published alphas; the comparison below used source
candidates and does not establish a public-only factory installation. The
Semantic Router below is a separate ordinary Flow package; its deterministic
tests do not establish a live installed factory run.

## Run the supplied batch

After repository workspace setup, inspect `batch.json`, the Agent, single-pass and checked-correction
Bindings, and both named case files. Select and authenticate your Agent, then:

```sh
jig review --allow-resolution-network
jig run binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m
```

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
`flows/factory/methods.ts` supplies opaque IDs and descriptions and maps them to
reviewed slots. A second proposal is a work budget choice, not weaker acceptance.
With no preference, the candidate data describes checked correction as the default.
Use an explicit menu when the operator already knows which configuration to select;
it avoids a routing call and its uncertain judgment.

The [Semantic Router source package](https://github.com/jiggy/jig/tree/main/examples/software-factory/flows/router)
is independently reusable. It accepts only task text and a bounded candidate list,
uses the ordinary Agent contract, and returns a supplied ID with a reason or null
for abstention. Candidate IDs and descriptions are data, not executable selectors.
It has no host registry, provider configuration, or factory-specific prompt.

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

The resulting correction verifies every projected attachment's byte count and
digest in Jig's trusted inner launcher before Flow code starts; the repair input
layer also rejects incomplete and wholly empty reads. Replaying the same adapted
input now fails before any worker or Agent call. The cause of that 24-file
projection mismatch remains a source-candidate limitation; a separate 24-file
nested host projection check passes, so this evidence does not justify a broader
root-cause claim.

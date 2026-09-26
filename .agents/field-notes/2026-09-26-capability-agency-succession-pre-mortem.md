# Expand human possibility: a maintainer succession pre-mortem

- **Status:** Historical, non-normative field note; optional reading.
- **Recorded:** 2026-09-26 UTC.
- **Recorder:** Primary Codex maintainer in session/thread
  `01a0d7a1-7802-7b93-ab55-fec284e23ba8`.
- **Evidence window:** Supplied project discussions and recorded delivery
  history from September 2026, plus firsthand qualification, publication,
  roadmap and branch-reconciliation work. Tracked history inspected through
  `a848bc9a2f6f1e2f73b4e36be966d704fb1cc7c1`.
- **Scope:** Product intent, distinctions vulnerable to simplification, causal
  engineering lessons, and the judgment I would want a successor to inherit.

This is the note I would want to find if I returned without remembering the
work. Its purpose is to preserve reasons, not to make someone reconstruct our
conversation. It is not a specification, task list, release receipt or source
of additional authority. The [product compass](../product-compass.md),
[doctrine](../doctrine/purpose.md), applicable instructions and current public
contracts take precedence. A past observation does not qualify a later build.

Some lessons below come from earlier contributors' recorded experiments, not
experiments I personally repeated. Where precise raw records were temporary,
I embed the relevant observation and its limits rather than imply the reader
can retrieve a vanished notebook. Git landmarks identify inspectable changes;
they are investigative context, not instructions to restore old code.

## 1. The deepest intent

**Expand human possibility.** Make useful work achievable for more people and
make meaningful direction over that work practical.

The opportunity is not merely more automation. It is a world in which someone
develops an effective way of doing work, and someone else can inherit that
competence without reconstructing the method or adopting its creator's entire
system. Improvements can then become a better starting point for others.

| Project | Core idea | Intended contribution |
| --- | --- | --- |
| FLOW | Capability compounding | Executable know-how that others can apply, evaluate, adapt, combine and share |
| Jig | Agency | Power under control, available to people, applications and subsystems |

Executable know-how is more than an answer or a description. A method can
preserve ordering, context separation, tools, checks, correction and stopping
criteria. Its recipient gains a working approach rather than another piece of
advice they must translate into coordinated action.

The intended compounding loop is:

```text
capture a useful method
    -> apply or combine it elsewhere
    -> evaluate what worked and what did not
    -> preserve and share the useful contribution
    -> let the next builder start with greater capability
```

This is a product hypothesis, not a law of automatic improvement. More copied
packages, more generated text and more Agent calls do not establish compounded
capability. Bad assumptions can spread too. An unchanged method reaching a new
useful application can contribute capability without being rewritten.

Portability and composability are means to FLOW's purpose. Ownership,
replaceability and local authority support Jig's agency. I would not mistake
these mechanisms for the entire reason anyone should adopt the products.

Nor would I rename Jig's core idea "human agency." Software subsystems are
legitimate consumers exercising delegated powers. Human possibility is the
larger aspiration, not a requirement that every interface or decision have a
human in the loop. Likewise, ownership alone is not Jig's product promise:
people want to accomplish more and direct that power, not administer ownership
as an end in itself.

Safety serves that promise. A host that only restricts work delivers half of
it; a host that expands power without meaningful direction delivers the other
half. The whole product must make useful delegation practical.

### The pyramid is authority, not decoration

The aspiration and core ideas constrain principles; principles constrain
design commitments; those constrain specifications and plans; all constrain
implementation. Specific safeguards accumulate downward. Invoking agency,
compounding or simplicity does not waive a narrower authority boundary.

FLOW and Jig are sibling branches. Making Jig convenient cannot silently make
FLOW depend on Jig. A lower-level conflict needs resolution at its owning
level, not a clever reinterpretation or an exception hidden in an example.

The [shared purpose](../doctrine/purpose.md), [FLOW branch](../doctrine/flow.md),
[Jig branch](../doctrine/jig.md) and [design judgment](../doctrine/design-judgment.md)
own this reasoning. This historical note cannot select an API merely by
appealing to the same values.

## 2. Distinctions I would protect before simplifying anything

The most dangerous regressions erase a distinction that initially looks like
bookkeeping. Good simplification removes repeated coordination while keeping
the distinction true.

### Source is not authority

Visible editable files propose work. Capture retains the meaning to evaluate
and review. Admission accepts one complete proposal against its expected base;
execution uses that immutable generation. Later edits do not inherit approval.
Finding, downloading, parsing or hashing something cannot grant execution.

A portable lock and local consent answer different questions. Sharing
reproducible project meaning does not share permission to run it. A crash
between publishing inert project meaning and admitting it must not expose
mixed authority. A root and its dependencies must not drift into different
live catalogue revisions halfway through an invocation.

Private snapshots may be necessary for exact execution. They must not become
a competing hidden authoring source whose effective meaning the user cannot
inspect. User-owned edits and exact accepted execution are complementary,
not excuses for runtime patch overlays or opaque customization precedence.

### Intelligence is not authority

A model can interpret, propose, criticize and select inside delegated bounds.
Its output remains data until authorized policy acts. Naming a route, asking
for a credential or producing a convincing answer does not create a power.

Eligibility, compatibility, admission and policy are established before
optional semantic choice. Validate any choice against that closed set. An
unavailable target or abstention should remain an honest outcome, not trigger
an unreviewed fallback. Known explicit choices should not require model calls.

Model correctness and boundary enforcement are separate. Prompt injection or
misdirected reasoning must not be able to grant new authority. Already granted
powers can still be misused, which is why domain checks and consequence policy
remain responsibilities of their real owners.

### Methods are not host policy

Flows own their procedures, prompts, selected guidance and interpretation.
Runtimes advance their own programs or graphs. Applications own purpose,
domain state and consequence policy. Operators select powers and data posture.
Jig enforces authority, execution ownership and lifecycle across boundaries.
FLOW supplies independently usable package and invocation meaning.

The ACP separation reinforced this split: Agent prompting, answer preparation
and conversation policy can live in ordinary replaceable methods, while native
credentials, network grants, process ownership and cleanup stay host-owned.
Uniform invocation does not make an editable method part of the trusted host.

A method must not force the recipient to adopt its author's model provider or
infrastructure. But extracting code from Jig is not automatically progress.
Judge an extraction by the reuse, replaceability or reduced consumer burden it
enables while keeping the host's responsibilities enforceable.

### A cancellation request is not settled cancellation

Prompt acceptance, native turn activation, interrupt acknowledgement, actual
turn termination and invocation cleanup are distinct events. A natural result
can win a race with interruption. An accepted request does not establish that
work stopped, and closing a local waiter cannot manufacture that proof.

Owned work includes descendants, not only the process that returned an answer.
Ownership and aggregate resource limits must exist before untrusted execution,
remain through fencing and cleanup, and account for coordinator loss. Uncertain
dispatch must not be disguised as safe retry. Failed cleanup remains visible.

An old owner must conclusively settle before a replacement is allowed to act.
This is especially important for handoff: two session-mutating owners must not
coexist because one stopped receiving progress. Local cancellation cannot undo
remote consequences already completed or requests already accepted remotely.

### Observation is not execution or control

Progress can be incomplete while work succeeds. A clean stream end does not
prove producer success. A receiver's schema or capacity failure should not
automatically contaminate healthy work when the specified isolation boundary
permits independent recovery.

Channels grant specific communication rights, not arbitrary participant access.
Sending a command-shaped JSON value is not itself authorization to execute it.
Meaning needs an agreed contract, not merely a superficially similar schema.
Applications choose what to publish, filter and present; ACP must not become
FLOW's universal vocabulary or a private host echo of suppressed content.

For session maintenance, the owner that can mutate the session must enforce
the dispatch boundary. Listener priority or a "hold" message cannot enforce a
mutex by itself. Context replacement can invalidate queued reactions and must
not lose newer user instructions. It cannot retract already observed events
or undo completed effects. These considerations do not authorize a generic
host lock, queue or session-replacement subsystem.

### Ordinary recovery is not an acknowledgement ritual

The channel design briefly pursued perfect accounting for forgotten failed
operations through a global error ledger. That would have made ordinary caught
SDK errors require extra acknowledgement, even for channel-free Flows.

The cost was too broad. Ordinary language recovery should remain ordinary.
Disposal can settle a racing observation failure and expose a cause the caller
has not yet received, without requiring everyone to adopt a new error ritual.
The deliberate tradeoff is not detecting every settled rejection that an
application neglects. It is not permission to abandon live work, acknowledge
away root cancellation or pretend uncertain ownership was settled.

Account for owned work; do not try to prove that application code understood
every result. Removing the public acknowledgement method without removing its
ledger would not have resolved the design burden.

### Execution success is not application acceptance

A Run can finish successfully while returning an unsuccessful domain outcome.
A valid envelope or structured answer does not make the content true. Host
collection can establish actual command output and termination without making
the command's assertions independently trustworthy.

In repair work, candidate code may interfere with the repository's runner.
Application-owned assertions should inspect captured behavior without
importing candidate code or trusting its reported pass flag. Keep acceptance
expectations outside the proposed patch, preserve candidate identity and actual
evidence, and reproduce the original defect before evaluating its repair.

A passed patch is review-ready material. It is not permission to apply, merge,
release or deploy. The human merge gate belongs to the demonstrated factory's
policy; other applications can have different explicitly delegated consequence
policies. Do not universalize that example into mandatory human approval for
all Jig work.

### Retained evidence is not resumable execution

The retained-progress design saved explicitly submitted bytes after an
independent owner acknowledged them. Replacement validated and copied the
whole checkpoint before replacing the previous one. Publication waited for
the required cleanup, and execution status stayed separate from file origin.

That protected completed evidence from later interruption while the independent
command owner survived. It did not establish arbitrary scratch salvage,
machine-crash durability or automatic replay. A checkpoint acknowledgement,
an observed update and a final accepted result are different facts. Preserve
healthy peer evidence without converting an interrupted batch into success.

### A source revision is not artifact identity

Packaging and dependency resolution can change bytes. Publication must consume
the retained candidate that passed its exact-revision gates, not rebuild a
similar archive afterward. An immutable registry version cannot be reused
because the changed files seem inconsequential: shipped tests count too.

Registry-visible alpha versions are not compatibility promises. Removing a
superseded draft interface is different from overwriting a published archive.
Replace provisional semantics coherently; publish changed bytes under a new
package identifier. Do not create prerelease compatibility archaeology to
avoid synchronizing specifications, schemas, implementations and examples.

Parallel qualification can finish out of order. An older publication must not
demote the channel, and an exact historical retry should not wait indefinitely
for its version to become newest again. Retain authorization boundaries and
immutable-byte checks while making release recovery useful.

### Missing support is not equivalent execution

An unsupported runtime, mechanism, contract or isolation requirement must fail
honestly. A script, prose interpreter or weaker sandbox is not an equivalent
fallback merely because it can produce an answer. Likewise, a development-host
wrapper or partial binary copy is not the native runtime closure the product
qualified. Host-local adaptation must not silently become public semantics.

## 3. What simplicity actually means

I repeatedly needed to move from counting methods to considering the complete
consumer task. A tiny interface can require extensive declarations, duplicated
schemas, physical installation paths and hand-written lifecycle coordination.
That is not a simple product.

Useful questions are: what must the author understand, how many decisions and
files must they manage, which installer details leak, and how much recovery
code must they repeat? A helper can preserve important result/settlement
distinctions without teaching every simple caller the full control protocol.

Progressive disclosure means the ordinary path remains ordinary and advanced
tasks reveal the additional controls they need. Defaults must not silently
grant powers, choose consequential policy or replay uncertain work. Bindings
should earn their burden through customization, not become compulsory files
for every component. Formal contracts earn their cost at independently
maintained interoperability seams, not merely because a method is elaborate.

There are two equal and opposite traps:

- Conceal a product gap with an example-specific launcher or private helper.
- Absorb application policy into Jig to make one example shorter.

The correct response starts by identifying the owner of the burden.
"Microkernel-inspired" communicates responsibility separation; it is not a
mandate to minimize core line count, maximize extraction or build a service
framework. Private machinery can be substantial when it preserves an observed
safety invariant. Equally, invoking safety does not justify machinery whose
responsibility has disappeared.

## 4. Historical mistakes and what they taught me

### Verification became the default deliverable

The repair effort sometimes accumulated reports, repeated probes and more
elaborate proof notebooks while the ordinary user-facing path advanced little.
The owner repeatedly redirected the work toward useful product increments.
I would remember that correction before proposing another evaluation campaign.

A check needs a question, a bounded scope and a stopping condition. Start with
the changed boundary and relevant integration proof, then use the existing
release gates at their actual integration point. Do not replay the entire
historical experiment collection for each application or documentation edit.
State what sustained verification will decide and keep the user informed.

An experiment can finish unsuccessfully. An unproved marketing advantage limits
claims; it does not by itself prohibit further implementation. Safety gates
remain gates. A new comparison is justified by a new decision-relevant question,
not by disappointment with the previous result.

### I proposed hiding a bad command instead of fixing the seam

The repository-facing repair attempt had an awkward Bun command and confusing
adapter files. I proposed putting flags in a small launcher. The owner rejected
that: hiding complexity would not improve Jig for other users.

The durable insight was to inspect the task: capture selected input, invoke an
accepted method and return a useful evidence packet. Legitimate application
policy stayed local; reusable file capture and delivery belonged at the host
boundary. The lesson is not that launchers are always wrong. It is that a
wrapper is not a remedy when every consumer would have to invent the same
missing product behavior.

Examples, Starters and design probes also have different purposes. Authored
examples teach recommended composition; Starters give users a coherent owned
application; probes test a frozen interface from a consumer's position. A
directory name does not turn co-design into independent evidence.

### A model reviewer rejected valid work despite correct Skill delivery

Earlier workshop evidence showed valid arithmetic being rejected and an
ineffective continuation rule surviving into a proposal. One missing draft
limited reconstruction of that experiment. The right conclusion was bounded:
the method evaluation was unsuccessful, not proof that Skills never arrived.

Actual request-recording tests checked direct and child delivery of selected
Skill/reference bytes, exclusion of unselected content and protection against
post-admission edits. The tracked landmark is `db042940`. This separated delivery
from obedience. A further prompt-tuning cycle was not needed to justify coding
work, and the unreliable prose reviewer did not become mandatory approval
authority for the factory.

I would distinguish guidance delivery, model compliance, structured shape,
semantic correctness and independent evidence. Another Agent can be useful,
but agreement is not a substitute for execution or a genuinely different
source of evidence.

### The input bug was diagnosed at the wrong apparent layer

A builder's captured nonempty files appeared empty in child execution. A
size/digest guard correctly refused inconsistent execution, but protection did
not complete the consumer's task. An application read-offset workaround was
not a substitute for repairing the host.

A deterministic reproduction of the exact 24-file case traced the first
divergence to descriptor remapping during spawn. Child stdio targets beginning
at descriptor 6 collided with sealed input descriptors occupying those slots.
Duplicating the source descriptors above the target range before launch fixed
the transfer; the duplicates were closed afterward. The identity guard stayed,
the example workaround was removed, and ordinary reads worked again.

The landmark is `5839825e`. The important general lesson is to trace exact
identity at successive boundaries and repair the first demonstrated divergence.
An adjacent passing fixture does not explain a failing retained case.

### Runtime closure and resource policy were real responsibilities

Recorded subprocess work found aggregate PID/thread exhaustion rather than
OOM. Thread-pool and small-runtime workarounds did not solve it. The eventual
bounded policy correction changed reviewed recipe identity rather than letting
an old admission execute silently under different limits (`0e969818`).

Separately, clearing a contained subprocess environment broke dynamic-library
loading. A child needs its enclosing runtime closure; it does not need the
outer coordinator's secrets. Copying just an installed executable likewise
omitted adjacent support assets. These failures argue for exact runtime closure,
not ambient host access, development-machine library paths or weaker containment.

### Native interruption had more than one asynchronous boundary

An early installed conversation experiment reported uncertain unfinished work
when interruption followed prompt acceptance immediately. Delaying interruption
produced a clean cancelled turn. That was evidence of timing dependence, not
evidence that arbitrary sleep was the correct product fix.

The qualification work first corrected registration of a pending turn before
asynchronous prompt setup (`c88a38a3`). Subsequent tracked work addressed native
turn activation before dispatching interruption (`a848bc9a`). Those are distinct
boundaries. A previous green run must not end scrutiny when a later precise
test reveals another race; conversely, neither finding justifies a new general
scheduler or queue.

I would test the actual native transition and settlement, not only a fixture
that emits convenient acknowledgements. A naturally completed racing turn can
be valid, so tests must not demand that cancellation always wins. They must
prove that interruption targets actual work and that ownership settles honestly.

### Qualification failures were not all product failures

Installed qualification first exposed a missing package-manager executable in
the delegated test environment. Later, an imported descriptor had hardlink
aliases outside the selected source tree. Fixing fixture preparation addressed
those setup failures without weakening capture rules. Neither observation
established a native conversation defect before the conversation even started.

Conversely, once setup worked, a generic sanitized conversation failure was
not enough to diagnose the lifecycle. Public errors need useful bounded cause
and phase information without exposing credential-bearing native details.
Avoid both dumping private stderr and erasing every actionable fact.

### An uncapped native request was mistaken for a generic funding problem

During qualification I inspected a controlled native Responses request. It
omitted an output-token cap. Forwarding that unchanged synthetic request to the
selected Mistral endpoint returned HTTP 402 for credit/token reservation; adding
a 1,024-token cap made that diagnostic request complete. The client did not
offer the assumed output-cap configuration, so inventing one was not a fix.

An authorized free routing endpoint accepted the unmodified native request.
Qualification then used client-specific test inputs (`45873b09`), leaving product
defaults, authority and cancellation untouched. A temporary relay was diagnostic
only and was not promoted into Jig. Another suggested free endpoint had failed
with HTTP 404; "free" is not an availability or feature-support guarantee.

Use the actual selected wire API and request when diagnosing compatibility.
Chat Completions compatibility does not establish Responses compatibility.
Endpoint access and request limits belong to the relevant seam; a development
gateway is not automatically a new product provider abstraction. Test choices
are not production defaults, and subscription-backed testing is not free.

### Publication rejected bytes we were tempted to dismiss

After native qualification passed, publication refused an Agent method archive
under an existing immutable version. Comparison showed only two shipped test
files had changed; runtime and declarations matched. The original ACP candidate
matched its published archive, but advancing the method version changed ACP's
packed development-dependency metadata too.

Both package identifiers therefore advanced coherently (`63357206`). I did not
discard regression tests, weaken archive comparison or overwrite a version.
For that historical revision, CI, full Linux host conformance, native Codex,
Claude and Pi qualification, and protected publication completed successfully.
That is dated evidence, not a claim about every later commit or environment.

The native installed test combined a frozen Jig candidate with identified
published Agent dependencies. Runtime-byte equivalence explained why the
metadata/test-only update did not require a duplicate consumer campaign. It did
not turn an earlier package into a claim that a new archive had been installed.

The separate out-of-order-release correction (`f97ed6ba`) preflighted the complete
package set before mutation, kept dependency order, distinguished verification
from publication and supersession, and prevented old candidates moving a tag
backward. Do not replace immutable identity with an intuitive "same enough."

### Semantic selection became ceremony for a known choice

The factory initially called a router even when the operator already knew the
desired correction budget. Making explicit/default method selection direct
removed an unnecessary model call; only automatic selection used bounded
semantic choice (`d03e28dd`). Later routing work can evolve, but this historical
lesson does not depend on one permanent input shape.

Choose intelligence where interpretation adds value, not to ceremonially
rediscover an explicit decision. Keep abstention and closed-set validation
honest. Do not silently fall back because a semantic route was inconvenient.

### A completed comparison was treated like unfinished persuasion

Recorded small factory comparisons tied or favored the simpler alternative on
their selected measures. One apparent operator-effort improvement depended on
counting an unrelated direct-arm command typo; excluding it produced a tie,
while the direct Agent accepted two patches and the factory one. In another
two-issue comparison both methods accepted both patches, but the routed method
took about 128 seconds versus 96 seconds for fixed selection.

Those are completed, bounded results. They do not prove superiority, and moving
to timing or another convenient metric afterward would not rescue the original
claim. The factory can still offer useful inspectable evidence and healthy-peer
retention. Its value must be demonstrated on the dimensions it claims, against
a strong simpler baseline, not asserted because its architecture is elegant.

### Plans survived longer than their tasks

The roadmap still listed factory adoption, native qualification and handoff
implementation as future work after distinct evidence or implementation existed.
Updating it (`3915b112`) removed stale prerequisites rather than reopening them.

A branch conflict made the same problem concrete: one branch deleted the
installed-contract task after implementing package selection (`abffbb67`), while
another expanded its checks and linked a guide follow-up. Keeping the deletion
was appropriate; remaining consumer verification and unfinished guide work
belonged in the follow-up. Restoring the whole proposal would falsely imply
the importer still needed implementation.

Preserve unfinished obligations, not obsolete task descriptions. Existing
implementation does not make a bad direction permanent; a different preferred
name does not make a good implementation defective. Inspect the actual work.

## 5. Evidence I would refuse to collapse into one badge

| Evidence | What it can establish | What it cannot establish alone |
| --- | --- | --- |
| Controlled SDK/application test | Behavior under its specified inputs and races | Real native support, containment or ordinary adoption |
| Source workspace use | Composition against the checkout | Registry installability or correct packed contents |
| Frozen archive test | Behavior of the identified candidate | Publication or behavior of a rebuilt archive |
| Host conformance | Exercised guarantees under the stated host/threat model | Every deployment, provider or application policy |
| Registry verification | Distribution and identity of published bytes | Useful outcomes or native lifecycle reliability |
| Installed native-client check | Particular client, authentication and lifecycle behavior | Every client, restoration path or environment |
| Consumer exercise | Usability from the actual public inputs and access supplied | Technical clean-room isolation or broad product advantage |

Successful later factory adoption used published packages and public materials
on two different small projects, Pantry and Receipts. The original defects were
reproduced, repository commands passed after repair, and all seven unchanged
independent acceptance cases passed. Earlier provider attempts failed before
proposals, including an opaque HTTP 422 and an unavailable free endpoint. Those
failures remained part of the record; the successful route did not erase them.

The consumer had shared-filesystem access and root instructions injected into
its conversation. Its example copy lacked Git metadata, limiting independent
source-revision verification. This was useful public-interface adaptation,
not technically enforced clean-room isolation. A separate earlier candidate
exercise demonstrated selected-job cancellation with a healthy peer; those
are not one combined latest-registry qualification.

Likewise, an earlier minimal Node/Bun implementation consumed six unchanged
package files through public FLOW contracts, classified three valid inputs and
rejected malformed/duplicate-member JSON without importing Jig. It did not
implement the complete host contract, all channels/attachments or containment.
That bounded outside-Jig proof supported independence without establishing a
second production host.

An independent consumer needs a frozen public surface and no platform-edit
authority. A fresh agent label is insufficient if it inherits private context,
can inspect internals or receives maintainer implementation hints. Record actual
access and assistance. Experienced contributors should author recommended
examples; they should not call those examples independent consumption proof.

When receipts may disappear, preserve the observation, artifact distinctions,
failure and ceiling of the claim. Do not invent process exit codes or logs a
failed boundary never returned. A timeout, optional skip or incomplete aggregate
is not a pass. Several partial successful runs are not necessarily a completed
current host gate.

## 6. Working judgment I would pass to a successor

### Start from a user outcome and its owner

Ask what an ordinary consumer can accomplish afterward that they could not
accomplish, or could not reasonably manage, before. Then identify the smallest
missing boundary, its responsible owner, authority involved, failure behavior,
evidence required and stopping condition.

Use exact calls and ordinary data where sufficient. Introduce contracts for
real interoperability, semantic choice for real interpretation, and new host
mechanisms for responsibilities the host must enforce. Completing a phase does
not authorize the next subsystem. A working outcome can justify stopping even
when many attractive extensions remain imaginable.

### Investigate first divergence, not first plausible explanation

Freeze the relevant input and replace intelligence with a deterministic probe
when diagnosing transport or identity. Trace the same bytes, request or owner
through each boundary. Separate pre-dispatch refusal, dispatched uncertainty,
ordinary application failure and incomplete cleanup. Hypotheses should remain
labelled until evidence assigns the cause.

Failures in a development host are not automatically product requirements.
Failures in the product are not automatically reasons to widen authority.
Preserve exact runtime closure, distinguish inherited safe environment from
outer secrets, and correct supported behavior at its real owner.

### Use specialists to resolve concrete uncertainty

Ask specialists to challenge a specific contract, authority boundary or diff.
Cross-evaluation can expose contradictions that independent first proposals
miss. Preserve dissent and changed positions rather than manufacture consensus.

A jury chooses a candidate direction; it does not establish ease of use or
runtime correctness. Once the design is sufficiently resolved, implementation
and consumption answer the remaining questions. Do not keep convening broad
reviews to avoid owning ordinary engineering details.

The project owner should not have to shuttle routine confirmations between
teams. Coordinate the implementation yourself. External reports use the assigned
team identity; that coordination label does not belong in shared instructions.

### Continue within authority; escalate only the real missing prerequisite

One blocked outcome does not stop independent authorized work. Commit stable
in-scope slices, retain useful experimental evidence separately when appropriate,
and continue the tasks that can advance. A fixable harness defect, unfavorable
experiment or missing ambient tool is not automatically an owner blocker.

Escalate a missing credential, infrastructure capability, external ownership,
budget or material product decision precisely: what is unavailable, which safe
alternatives were exhausted, and which owner action unlocks it. Persistence
does not broaden authority. Do not turn the user's desire for momentum into
permission for arbitrary spending, publishing, pushing or weakening guarantees.

### Verify proportionately and finish the useful slice

Choose evidence before making the claim. Put focused tests inside each slice,
not in a final hardening phase. Complete the ordinary consumer path as well as
its relevant failure and cancellation behavior. Keep source, candidate,
installed and release checks distinct; do not present overlapping test counts
as additive independent proof.

For CI improvements, measure critical-path duration, queueing, aggregate runner
time and push-to-registry delay separately. Recorded parallelism shortened the
host gate substantially while total runner consumption rose. Faster execution
did not guarantee faster delivery when GitHub queueing dominated. Keep required
shards fail-closed and isolate containment workloads rather than optimizing
only a displayed duration.

### Keep instructions lean and historical material in its own owner

Root and scoped instructions are read by unrelated agents. They are not a diary
or a place for temporary team labels, moving package versions or every lesson
from a failed command. Put stable responsibilities in the nearest owning guide;
keep release identifiers in manifests and identified historical evidence.

Examples can legitimately pin public dependencies for reproducible consumption,
with mechanical synchronization checks. That is different from putting moving
versions into broad agent instructions. Ordinary workspace declarations serve
local development; frozen archives serve distribution and installed-artifact
tests. Neither should be used to conceal a missing public dependency.

Living docs should be first-time entrypoints. Avoid language that makes a new
reader wonder which forgotten conversation they must recover. A historical
note can explain past causality, but cannot become required onboarding or a
second current roadmap. Do not retain superseded APIs under the cover of history.

## 7. My pre-mortem: how a capable successor could still fail

I would worry less about lack of intelligence than about optimizing the wrong
thing. These are the failure modes I would check first:

- **An impressive platform replaces a useful product.** Many mechanisms exist,
  but an ordinary consumer cannot explain what valuable task became easier.
  Return to one outcome and the smallest necessary seam.
- **Safety becomes restriction without power.** The product is well-contained
  but difficult to adopt or compose. Improve usable direction, not just denial.
- **Convenience erases authority.** A dependency update, fallback or helper
  changes accepted meaning or grants powers without consent. Preserve the exact
  boundary while removing avoidable ceremony.
- **An elegant API exports lifecycle bookkeeping.** Simple callers must
  coordinate every stream, turn, disposal and settlement manually. Place repeatable
  coordination at its responsible reusable layer without hiding outcomes.
- **A progress signal is mistaken for a terminal fact.** EOF, an interrupt
  acknowledgement or a checkpoint is treated as proof of successful work.
  Inspect actual result, ownership settlement and evidence origin separately.
- **A model becomes an approval authority accidentally.** Its selection or
  review text acquires permissions or overrides acceptance policy. Keep model
  output as data acted on under established policy.
- **A green historical run excuses a new defect.** A later artifact, native
  version or asynchronous boundary differs. Qualify the changed claim precisely
  without reopening every unrelated campaign.
- **A benchmark failure turns into endless tuning.** Metrics or fixtures shift
  until the architecture wins. Preserve the result and identify a genuinely new
  question before another comparison.
- **A stale task sends the next agent backward.** Completed work is rebuilt,
  a dead blocker is escalated, or an obsolete note survives branch integration.
  Reconcile current code and evidence before planning.
- **The owner becomes the team's coordinator.** Routine handoffs, confirmation
  requests and avoidable blockers consume their attention. Own engineering
  coordination and reserve escalation for choices that actually need them.

These are historical warning signs, not additional gates or blanket prohibitions.
An explicit future decision and suitable evidence can justify revisiting a
tradeoff. It must still satisfy the current authority pyramid.

## 8. How I would get oriented without remembered context

I would rebuild judgment in this order, without reading every old report:

1. Read the [root instructions](../../AGENTS.md),
   [product compass](../product-compass.md), doctrine branches and
   [maintainer guide](../maintainer-guide.md). Understand purpose and authority
   before choosing mechanics.
2. Inspect Git status, branch/worktree topology and relevant commits. Preserve
   another contributor's unfinished edits. A previous handoff's clean checkout,
   release claim or open blocker is not evidence of today's state.
3. Read the [roadmap](../coordination/ROADMAP.md) and relevant owning specification.
   Use [FLOW specifications](../../docs/flow/spec/) for portable mechanics,
   [Jig specifications](../../docs/jig/spec/) for host contracts, and applicable
   subtree instructions for implementation responsibilities.
4. Identify one consumer task and compare its public usage with the actual code.
   The [conversation guide](../../docs/jig/guide/conversations.md),
   [channel guide](../../docs/jig/guide/channels.md) and
   [incident-brief example](../../examples/incident-brief/README.md) show different
   layers of existing composition; they are not evidence of every future use.
5. For safety or release work, read [security](../../SECURITY.md) and
   [release guidance](../../RELEASING.md), then inspect current exact artifacts,
   automation and registry state. Never inherit a mutable release fact from me.
6. Consult this note or the
   [earlier maintainer retrospective](2026-09-24-returning-maintainer-pre-mortem.md)
   only when a relevant shortcut or rejected path needs causal explanation.

The compass restores purpose, specifications restore exact mechanics, tests
restore executable expectations, and current code plus artifacts restore
reality. No single file can replace all four. This note preserves the reasoning
that helps a successor interpret them and choose the next useful action.

## Final reminder

> Build something others can genuinely use and build upon. Keep its power
> governable. Simplify the experience without erasing the facts that make it
> trustworthy.

I would rather leave a successor able to reach the right decisions again than
able to repeat every decision I made. My most useful contribution is not a
permanent API or another completed notebook. It is the habit of relating a
consumer's useful outcome to the smallest honest, enforceable boundary that
makes it possible.

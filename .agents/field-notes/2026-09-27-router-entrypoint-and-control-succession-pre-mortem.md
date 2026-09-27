# Inherit useful competence, retain direction: a succession pre-mortem

- **Status:** Historical, non-normative field note; optional reading.
- **Recorded:** 2026-09-27 UTC.
- **Recorder:** Primary Codex collaborator in session/thread
  `01a0d36e-4bb4-76f2-acd9-718cbdcbb537`; both environment identifiers exposed
  that value.
- **Evidence window:** The supplied Jig/FLOW purpose and routing discussion,
  firsthand project-entrypoint, CLI presentation, contained-effect deadline,
  factory integration and commit work, and repository history inspected through
  `3637844c1f9d7858b494ec6c6e87812b4a5029c2`.
- **Scope:** Reasons behind the design, distinctions vulnerable to accidental
  simplification, specific engineering observations, historical course
  corrections, and the judgment I would want a successor to inherit.

This is the note I would want to find after returning with no memory of the
work. It preserves causal understanding rather than an active task queue,
release receipt, specification, or additional authority. The
[product compass](../product-compass.md), [shared purpose](../doctrine/purpose.md),
[FLOW doctrine](../doctrine/flow.md), [Jig doctrine](../doctrine/jig.md),
[design judgment](../doctrine/design-judgment.md), applicable instructions, and
current public contracts outrank it.

The firsthand observations below are distinguished from earlier contributors'
historical accounts. I have embedded the useful facts and their limits rather
than linking to temporary reports or assuming that saved Run packets will
survive. No credential, operator-specific executable path, or disposable
evidence directory is needed to understand these lessons. A recorded observation
qualifies only the case that produced it, not a later build.

## 1. The deepest intent I would keep in mind

> Help people inherit the ability to do useful work, while retaining meaningful
> direction over what happens.

FLOW's substance is **executable know-how**. Someone captures a working method;
another person can apply, inspect, adapt, combine, and improve it. The method
may preserve ordering, separate contexts, selected tools, checks, feedback,
correction and stopping criteria that prose alone would leave each consumer to
reconstruct.

FLOW's purpose is **capability compounding**. The meaningful gain is that the
next practitioner can accomplish something they previously could not, or can
direct that work with a manageable burden. More packages, more generated text,
and more Agent calls are activity measurements rather than proof of that gain.

The loop I would hope to see is:

```text
capture a useful method
    -> apply or combine it in another setting
    -> evaluate its result and limits
    -> preserve and share what proved useful
    -> give the next practitioner a better starting point
```

Compounding does not require every consumer to rewrite the method. An unchanged
method reaching another useful application can contribute capability. Conversely,
copying an ineffective procedure can compound bad assumptions. Evaluation closes
the loop; portability does not guarantee transfer of competence.

Jig's purpose is **agency**, expressed as **power under control**. Recipients
should be able to use inherited methods under their choices about collaborators,
resources, data, limits, and consequences. People, applications and software
subsystems can consume this work under delegated authority. Human possibility is
the larger aspiration; it does not require a person to approve every already
authorized step.

The shared aspiration is **expand human possibility**. These ideas explain why
the projects deserve investigation and supply criteria for judgment. They do
not establish that a particular implementation achieves the benefit. Useful
applications and ordinary consumers must still earn that claim.

### The owner's correction that changed my framing

In the supplied discussion, portability and ownership were initially proposed
as the projects' central ideas. The owner asked what they enabled and why that
should matter. That correction was consequential: it moved the reasoning from
implementation properties to useful accumulated capability and practical agency.

I would remember it whenever a pitch, roadmap or design starts listing features.
Portability, composition, replaceability, permission checks and local ownership
support the purpose. Ask what they make possible for someone and what burden
they impose on that person's direction of the work.

The authority pyramid is equally consequential. Specific safeguards accumulate
downward. Appealing to agency or simplicity does not waive a precise contract.
FLOW and Jig are sibling branches; Jig convenience cannot silently subordinate
FLOW independence. A conflict needs resolution at its owning level and a
synchronized change, rather than an exception hidden in an example.

## 2. Distinctions I would protect before simplifying anything

### FLOW remains independently useful

A Flow should travel without requiring its author's host, framework, providers,
or infrastructure. Jig should be an excellent FLOW host, while FLOW's meaning
remains understandable and useful outside Jig.

The common boundary lets code and Agent judgment participate in one compositional
model. A caller supplies input and consumes an outcome and result whether the
method uses code, intelligence, or other Flows internally. The caller need not
reconstruct a different orchestration model for every implementation.

That common interface does not establish equal quality, latency, cost, effects,
required powers, or execution support. A host may support only particular
implementations and must state its limits honestly. Missing support cannot
silently become a substitute procedure with supposedly equivalent meaning.

### The method owns its procedure

Prompts, semantic routing, criticism loops, specialist roles, acceptance cases,
and application consequence policy belong in ordinary Flows and their libraries.
A component runtime advances the live program or graph inside a process. Jig
owns exact admission, supplied powers, execution ownership and lifecycle.

The original Caskada conversation concerned reusable intelligent procedures.
Its successor Sley helped clarify the runtime boundary. It did not establish
the need for a Jig graph language. A method's useful structure can be explicit
without making that structure host vocabulary.

Likewise, a router, Gauntlet, independent jury, research loop or handoff can be an
excellent reusable method. Its name is not a reason to add a matching kernel
primitive. Domain concepts such as tickets, Git worktrees and merge policy remain
application concerns even when the factory makes them important.

### Intelligence exercises supplied authority

A model can propose, create, criticize and select within permitted alternatives.
Its result is data. It cannot create a target, grant, provider or publication
right by naming one.

The meaningful ordering is:

```text
establish admitted, compatible, available and policy-eligible choices
    -> obtain optional semantic judgment or abstention
    -> validate the complete result against the closed set
    -> invoke the exact authorized route
    -> validate the outcome and its evidence
```

Membership validates only membership. It does not prove applicability, semantic
correctness or resistance to misleading candidate descriptions. A wrong choice
among authorized alternatives can still produce harmful or useless work;
applications retain domain checks and operators retain responsibility for the
powers they supply.

This boundary must remain effective when an Agent follows the wrong instruction.
Prompt quality can improve behavior but cannot become the source of authority.

### Approved meaning stays exact

Source proposes. Review captures and explains. Admission authorizes one complete
revision. Execution consumes that admitted meaning.

A downloaded package, portable lock, digest, parsed schema or successful build
is not local approval. Later source changes must not silently acquire the
authority of their predecessor. Admission needs one aggregate compare-and-set;
independently updating pieces can expose a mixed generation that nobody reviewed.

Review is also not effect-free. Dependency preparation can perform permitted
network activity before the final Run approval. Acknowledging supplied permission
does not undo those effects, and Run authority must not be inferred from them.

### Invocation data and reviewed resources have different lifetimes

An approved project recipe can say “read this job file when invoked.” Its current
bytes are then captured for each Run. Binding resources remain captured and
pinned by review.

If both are frozen during review, ordinary jobs require needless source review.
If both remain mutable during Run, reviewed tool resources can change underneath
approval. The distinction enables convenient application input while keeping
approved execution exact.

Path origins also matter. Project-authored defaults belong to the project;
explicit CLI paths belong to the calling directory. The host should explain
effective paths without exposing input contents or inventing shell expansion.

### Work keeps an owner through uncertainty and cleanup

A plausible answer is insufficient to settle work. Every launched activity needs
bounded ownership until its descendants are fenced, reaped and cleaned, including
when the coordinator disappears. Cancellation has to reach owned work rather
than merely stop the terminal's wait.

Possibly dispatched effects remain uncertain until evidence resolves them.
Automatic resend can duplicate a consequential effect. An operation identity
cannot be reused with changed content to manufacture a fresh interpretation.

Private machinery earns its complexity through these observed invariants. Fewer
lines or tables are not themselves a better design. Equally, a past lifecycle
requirement cannot justify machinery whose owning feature has been removed.

### Execution, outcome, delivery, progress and cleanup stay distinct

A completed Run can return an unsuccessful application outcome. A written packet
can contain a refusal. A checkpoint can preserve useful settled progress without
proving final success. An acknowledgement of cancellation can precede final
settlement.

These distinctions should have reusable coordination at their responsible layer.
Every caller should not have to recreate them through manual bookkeeping.
Simplification can remove that burden while preserving truthful meaning.

### Evidence describes the exact candidate

Tests and commands must evaluate the actual proposal under unchanged acceptance
policy. The proposal must not redefine success by changing its own checks.
Baseline reproduction helps establish that the observed improvement answers the
original issue rather than an invented task.

In the factory, separately checked patches remain separately checked patches.
Their combination needs its own evaluation. Overlap detection must not silently
combine conflicting work. Preserving a healthy peer's settled evidence through
failure or cancellation is valuable; unfinished work must not receive an invented
verdict or deliverable.

The human merge gate belongs to the factory's consequence policy. It is not a
universal requirement for every Jig application or already-authorized action.

### Control remains understandable

Review, defaults, errors, ordinary output and recovery are part of Jig's agency
promise. Technically correct enforcement can still leave an operator unable to
understand and direct the system.

Private details can remain private while a diagnostic names a known cause, the
configuration that selected it, and a useful next action. A machine record can
remain exact while its human presentation becomes concise. Evidence must remain
accessible when the terminal refers to a saved packet; uncertain delivery must
not hide the only visible result.

## 3. What the entrypoint work taught me

### An invokable catalogue did not explain how to use the application

The user tested the software factory through bare `jig run`. It offered the
Agent, repair configurations, factory and router as similarly prominent choices.
Each could be an invokable component, but the catalogue did not communicate the
application's intended starting point or its required files.

The project entrypoint supplied that missing intention. It preserved component
invocation and explicit overrides while letting an unfamiliar consumer start the
application without reconstructing its wiring.

I initially underestimated this as a convenience. It was a practical agency gap:
the user's first decision required knowledge of composition internals that the
application author already possessed.

### Reusing a familiar declaration reduced the learning burden

I initially favored an expanded structured object for target, input, attachments,
output and duration. The owner preferred these two forms:

```ts
entrypoint: "binding:factory",
```

```ts
entrypoint: "binding:factory --input @batch.json --attach source=fixtures --out factory-result --timeout 8m",
```

The string reused the familiar arguments following `jig run`. The implemented
grammar stayed bounded and shell-free. It did not make operator controls,
environment substitution or arbitrary shell commands project defaults.

The lesson is not that strings always beat objects. Count the concepts a user
must learn, and distinguish a genuine ambiguity from our preference for another
structure. Two things can have entrypoints with readily understandable scopes:
the Flow's executable file and the project's starting invocation.

### Defaults had to survive the whole launch path

The installed launcher needs effective arguments before choosing command lifetime,
output ownership and delegation. Resolving defaults only when the Flow is about
to run can lose the intended timeout or destination during reexecution, or cause
another target prompt.

The selected admission also needs to survive those boundaries. Otherwise an old
entrypoint recipe can be combined with a newly approved policy. Selection and
submission must remain anchored to the same approval; a race should refuse the
invocation rather than silently reinterpret it.

The feature's historical rules included whole-input replacement, explicit-target
bypass even for the same target, per-name attachment overrides, and no fallback
from an unavailable entrypoint. A fixed output default retained the existing
no-replacement rule: the next Run chooses a new destination rather than erasing
the preceding evidence. These are observations of that design, not an alternative
specification; [Project Authoring SDK/1](../../docs/jig/spec/project-sdk.md#project-entrypoint)
owns the current exact contract.

The implementation landmark is `03cddd1f`. A packed ordinary consumer exercised
reviewed defaults with fresh job data, rather than depending only on repository
workspace behavior.

## 4. What the live logs taught me about truthful UX

The user supplied repeated ordinary CLI transcripts, including schema rejection,
missing native-client discovery, an occupied result destination, changed execution
environment, and successful factory work. They revealed consumer friction that
passing internal checks had not made obvious.

### A schema error did not prove stale approval

One failure rejected `/jobs/0/method` against the approved enum. The user suspected
that the application had simply missed `jig review`. Re-reviewing and approving
again did not make the input value valid.

The correct explanation distinguishes two possibilities: source edits need review;
otherwise the input must satisfy the already-approved schema. The host must not
guess source freshness from an input mismatch or evaluate live source during Run
to invent that diagnosis. Name the field and declared choice requirement, then
point to inspection of the approved contract.

The example also exposed drift between shipped input and the selected method IDs.
Validate supplied example data against its real user-input boundary. A smoke test
that bypasses the shipped batch cannot establish that the first public command
works.

### Sanitization should preserve a known cause

A missing Codex executable was reported at the provider's `FLOW.ts` with corrective
instructions but no clear cause or selection location. A later check showed that
the operator's shell name was an alias rather than an executable discoverable by
the host through `PATH`.

The useful public facts were that the client was selected, no usable executable
was found, aliases and functions do not satisfy executable discovery, and the
resource grant selected that client. An explicit invalid executable override
must not silently fall back. None of this required publishing private paths,
credentials or arbitrary exception text.

This is the general lesson: privacy and useful recovery information can coexist.
Preserve a bounded known cause separately from its next-step guidance, and report
the authored selection location when evidence actually supplies it.

### The terminal competed with its own error message

The early output printed an error and then expanded long result evidence. That
ordering invited the user to investigate the later dump instead of the actionable
failure. Failed execution needed emphasis beyond a colored title. Successful
factory output repeated large checkpoint and application evidence, including
patches and baseline failures, obscuring the final decision.

The correction kept distinct status words in plain output, emphasized host facts
in color, pointed to confirmed saved evidence, retained unseen diagnostics, and
ended failed Runs with their cause and recovery action. It did not infer success
from arbitrary application field names.

Dependency-network permission produced one warning for the review, while package
preparation kept its own progress. Already streamed diagnostics were counted by
invocation path rather than replayed as a nearly empty result section. Null
checkpoints and zero delivered-file counts were omitted from the human view;
exact machine values stayed unchanged.

The principle is economical attention without loss of evidence. The
[CLI experience contract](../../docs/jig/spec/cli-experience.md) and
[results guide](../../docs/jig/guide/results.md) own current behavior.

### Review refusal was useful evidence too

One supplied Run wrote a refusal packet because the selected execution environment
no longer matched approval. It reported no Flow started, zero delivered files,
and no checkpoint. Reviewing the changed environment allowed the next attempt.

That case was not evidence of a failed repair or a broken router. It showed why
host refusal, application outcome and packet delivery must remain distinguishable.
Development can legitimately change the approved execution environment; a demo
should not gain a special bypass to keep its transcript convenient.

## 5. What the Semantic Router and factory actually demonstrated

The router remained an ordinary Flow. It received task text and application-owned
descriptions with opaque IDs, invoked an ordinary Agent, and returned an exact
supplied ID or abstention. The caller validated the complete result and retained
the map from IDs to exact authorized slots.

The final supplied live packet embedded two automatic decisions:

| Job | Supplied requirement | Selected method | Observed bounded result |
| --- | --- | --- | --- |
| Access-log repair | Reject fractional and out-of-range HTTP statuses, count client and server errors separately, make one proposal and stop on failed checks | `p1` mapped to `single-pass` | One proposal passed the repository tests and four independent acceptance cases |
| Timesheet repair | Reject invalid clock minutes, handle midnight crossing, preserve zero duration for equal times, allow one correction after failed-check feedback | `p2` mapped to `checked-correction` | The first proposal passed the repository tests and four independent acceptance cases; no correction was needed |

The packet recorded both jobs as review-ready, no overlaps, and seven delivered
files. Original source remained the input to patch generation. The output did
not apply, combine, merge or release those patches. Four native Agent warning
paths were recorded separately from the answers and did not prevent completion.

The log-report acceptance cases covered client/server separation, empty input,
out-of-range status and fractional status. The timesheet cases covered day/night
duration, empty input, bad minutes and bad hours. Those fixed cases describe the
bounded check, not complete correctness for every possible project input.

The integration landmark is `129c0e8e`; its shipped batch omitted exact method
selection so the ordinary path exercised the router. Deterministic application
tests covered abstention, invalid envelopes, cancellation covering selection and
repair, preserved healthy-peer evidence, and refusal of forged worker evidence.
Those substitutes proved application boundaries rather than broad model quality.

### The tempting generalizations that remain unproved

Two correct selections are not open workflow discovery. A valid candidate ID is
not proof that its description was correctly interpreted. A successful small
factory Run is not comparative superiority or a general reliability claim.

The supplied earlier handoff review reported that a routed factory comparison
showed no completion advantage over a fixed `p2` baseline. I did not independently
repeat that comparison and do not preserve invented metrics for it. Its relevant
lesson is to retain tied and unfavorable outcomes rather than treating another
reasoning call as an improvement by definition.

Mandatory requirements and preferences were made explicit in the router prompt.
That instruction remains probabilistic. Candidate text can influence judgment,
including through instruction-like wording. A singleton still needs an
applicability judgment; an empty set can abstain without paid work. Operational
failure, blocked/limit, malformed data and completed abstention must not collapse
into one silent fallback.

The router deserves to grow through concrete consumer needs. A growing list of
methods alone does not select a catalogue, framework, kernel chooser or universal
planning language. Explicit composition should remain excellent, and any semantic
choice should justify its cost and latency for the outcome it claims to improve.

## 6. The deadline bug I would want a successor to recognize immediately

An earlier pre-dispatch timeout change returned before looking up a retained
contained-effect owner with the same operation ID. A retry after the deadline
could therefore bypass settlement of previously dispatched work while claiming
that it was not dispatched.

The dangerous simplification was ordering, not merely wording. Check the exact
identity, locate prior ownership, fence and settle it, and only then make a
conclusive claim about a new invocation. A previously owned effect remains an
uncertainty case even when the retry's own deadline has elapsed.

The correction in `994dc3e4` distinguished an undispatched expired operation,
a worker stopped at its effective deadline, and host settlement that could not
prove a result. The command and HTTP cases retained their different evidence:
local cleanup is not proof that a remote service received nothing.

The focused proof included a subprocess-isolated fault test for the prior-owner
ordering and interruption around owner release. A message-only assertion would
not have proved that lifecycle correction. Future wording changes should follow
what the responsible owner actually knows at that phase.

## 7. Earlier mistakes I would use as warning signs

These accounts come from the existing
[platform course-correction retrospective](2026-09-04-platform-course-corrections.md)
and inspected Git landmarks. I did not repeat all of the original experiments.
The [recovery index](../suspended-experiments.md) owns their detailed retrieval
points and reconsideration gates.

### Horizontal machinery arrived before an operable ordinary path

Hooks, services, journals, semantic-choice machinery and durability work accumulated
before an installed user could finish a simple useful Run. Some experiments had
real lifecycle lessons, but coupled concepts and tables made the direct outcome
harder to finish. `06eac5de` records the active-surface reduction.

The lesson is to remove coupled speculative machinery, preserve its useful causal
evidence, and recover only the invariant needed by a later approved outcome.
Isolated mature work need not be destroyed merely because it arrived early.
Completion of one phase supplies evidence; it does not authorize implementation
of the next subsystem. `abc8c3ab` records that course correction.

### A runtime wrapper tried to become a host graph language

Direct Sley interoperability was proved at `a4d1e281`. The rejected Jig lowering,
documented at `1b9a5a49`, wrapped a small direct graph in hundreds of implementation
and test lines without an independent stored-graph consumer.

The result did not devalue graphs. It limited what the host had earned the right
to own. Preserve the runtime's internal control unless a concrete consumer proves
that a new host responsibility is missing.

### The proof environment tried to become product architecture

Nix store paths, privileged containment, available credentials and development
gateways supplied useful test mechanisms. They did not define FLOW concepts,
operator defaults or supported product fallback paths.

The historical Nix-retention and privileged-containment detours are preserved in
the recovery index. The transferable requirement was an authenticated support
lifetime and observable fencing/cleanup, rather than host-global package-manager
ownership or permanent dependence on privileged development facilities.

Similarly, protocol-named Agent configuration replaced a development gateway
model at `4d257ac0`. A gateway is an operator-selected endpoint. Credentials or
cheap test models available to maintainers do not select a consumer's provider.

### Host convenience was transferred to authors

Mandatory bundling or copying dependencies into each Flow made ordinary TypeScript
work unnatural. `ec4f61df` records contained dependency preparation as the smaller
reusable correction. It was a deliberately bounded compromise, not a mandate to
grow a general package manager.

Runtime feasibility and lawful distribution also remained distinct. The external
Bun correction at `61c19421` followed an embedding approach that had distribution
obligations beyond proving execution. A working local artifact is only one part
of a distributable product.

### The process boundary was obscured by familiar SDK habits

The SDK's finite handler naming and stdout isolation corrections are recorded at
`31192837` and `78732275`. One process handles one Run and exits; familiar server
naming suggested another lifetime. Ordinary logging could corrupt protocol stdout.

Redirecting handler-time console output did not make every raw stdout source safe.
Top-level import logging, cached console methods and inherited child stdout had
different failure modes. Preserve what each correction actually proved.

### Demonstrations and probes concealed consumer friction

A probe that can redesign the platform while consuming it does not independently
evaluate the interface. Freeze public inputs, separate consumer authority from
platform edits, record assistance, and accept failure as evidence. A label such
as “independent agent” is insufficient when the builder received private context
or a maintainer's implementation plan.

Example-only launchers, copied libraries, injected dependencies and prepared
artifacts can similarly hide a public gap. Identify the actual consumer task and
fix the smallest responsible product layer. Keep legitimate application changes
local; correcting friction does not entitle the host to absorb domain logic.

### Green checks were promoted into broader claims

Controlled-Agent tests prove envelope and membership handling. Native-client
tests prove particular client behaviors. Packed and installed tests exercise
distribution and public execution. Comparative application evidence assesses a
claimed useful gain. None substitutes for the others.

During the commit closeout, focused CLI, entrypoint, linking and runtime checks
passed, as did the packed entrypoint consumer and the factory's deterministic
tests. A full activation-store run exceeded a 90-second wrapper after three
existing long tests; the new entrypoint race case passed directly. The bounded
claim was that the focused case passed, not that the timed aggregate was green.

Timeouts, filters, skips and interruption remain evidence limits. Narrow a slow
investigation to the relevant behavior without relabeling it a completed full
qualification. Broaden testing when the change or unresolved evidence requires
it, rather than repeating large suites as a substitute for judgment.

### Historical documents became competing authority

Chronological reviews once forced maintainers to reconcile old proposals with
current behavior. Consolidation restored clear owners, while causal evidence
remained useful in optional field notes and Git.

Preserve both lessons: living guidance should describe current contracts without
requiring remembered conversations; historical evidence should retain the reasons
behind difficult corrections without becoming another architecture or task queue.
Temporary reports can disappear, which is why the bounded observations needed for
this note are embedded here.

Superseded prerelease interfaces should be replaced coherently across code,
schemas, tests and guidance. Immutable published bytes still require a new package
identifier. That distribution fact is not a reason for draft compatibility
archaeology or aliases that keep a removed design alive.

## 8. The collaboration lesson I would give future me

Understand ownership before staging a shared worktree. A request to commit “my
changes” is not automatically authority to sweep adjacent contributors' work into
the same delivery. Dependency between edits is a reason to discuss or explicitly
explain scope, not to redefine ownership silently.

In this thread I initially said I would leave the factory agent's changes out of
the commit, then included the application as a separate slice because its new
entrypoint depended on the routing and input-contract changes. I communicated
that expansion before doing it and validated the application, but the stronger
practice is to establish the intended scope before staging other-owned work.

Slice by behavior, include its relevant tests and guidance, inspect the staged
names and diff, and keep unrelated edits intact. A clean worktree is not itself
a product outcome. Generated Run evidence must not be committed incidentally.
If evidence directories are absent at closeout, say what is actually known rather
than claim they were preserved or invent their disappearance's cause.

## 9. How I would judge the next proposal

Keep asking both questions:

> What useful capability becomes available?
>
> What burden does directing it impose?

The substantial enforcement work can make the second question dominate. Jig also
needs to expand useful power. Conversely, a convenient route that silently changes
authority, repeats uncertain effects or hides cleanup has not solved the consumer
task honestly.

Before an implementation, I would record:

1. The user-visible outcome and the strongest credible simpler alternative.
2. The layer that owns the missing responsibility.
3. The invariant that must survive the change.
4. The smallest observable proof, including the relevant failure case.
5. The concepts, configuration and manual coordination added and removed.
6. The superseded path that will be deleted.
7. The evidence limit and stop condition.

Existing method boundaries, SDK helpers, ordinary Flows and application policy
often supply the smallest correction. New kernel machinery needs a demonstrated
responsibility those layers cannot fulfill clearly. Minimalism concerns the whole
consumer task, not just the number of public methods or implementation lines.

Allow evidence to reject an attractive architecture. Allow a good implementation
to survive without inventing objections to demonstrate rigor. Carry an agreed
outcome through its focused proof, synchronized guidance, deletion and commit.
Then stop expanding it until the next outcome is selected.

The software factory remains a demanding demonstration of reusable methods,
independent checks and bounded consequences. Research, investigation and other
domains can expose different useful seams. The factory should reveal product
needs without becoming the kernel's application ontology.

## 10. How I would regain context with no memory

I would take this reading path, expanding only as the task demands:

1. Read the [root instructions](../../AGENTS.md),
   [product compass](../product-compass.md) and the relevant doctrine branches.
   Recover purpose, authority order and responsibility boundaries first.
2. Read the [maintainer guide](../maintainer-guide.md) for exact-execution,
   supplied-power and owned-lifecycle invariants. Use it as an entrypoint rather
   than reconstructing every historical experiment.
3. Read the [roadmap](../coordination/ROADMAP.md), then inspect fresh Git,
   manifests, artifacts and automation for the claim being investigated. Do not
   assume an earlier launch is still unfinished, or extend a completed launch's
   qualification to stable interfaces, a later release or general reliability.
4. Read the nearest applicable `AGENTS.md` and exact public contract for the
   selected task. Introductory guides help adoption; precise specifications own
   the boundary being changed.
5. Walk one ordinary consumer path: obtain, understand, review, run, inspect and
   stop. Observe what knowledge and coordination the consumer actually needs.
6. Consult the [historical recovery index](../suspended-experiments.md) only when
   a concrete proposal resembles a previous detour. Retrieve a specific lesson;
   do not restore an old subsystem wholesale.

I would treat this note the same way. It preserves judgment and causality while
the current owners establish rules, tasks and release state. It is not a reason
to reopen a suspended experiment or continue a former task automatically.

What I would most hope to find on returning is evidence that an unfamiliar
builder inherited a useful method, combined or adapted it successfully,
understood its limits, and retained direction over its consequences. That would
tell me the work was serving its deepest intent.

# Time-travel handoff

Restore an Agent's earlier decision context while keeping the work and lessons
produced since then. In the automatic variant, a supervising Flow performs
this transition for one busy worker while other workers continue.

**Status: use-case research, not an implemented Jig capability or an approved
API or roadmap commitment.** The manual practice and its benefits are
operator-reported. Automatic multi-Agent coordination and comparative benefit
have not been demonstrated here. The name describes the practice, not a claim
of a new general orchestration primitive.

## Problem and intended outcome

A long work episode can dominate an Agent's working context. Earlier goals,
decisions, alternatives, and discussions may be condensed while recent
implementation detail remains prominent. At the end, the Agent may have useful
new knowledge but little distance from the reasoning that produced its work.

The desired outcome is a worker that continues from the current implementation
with the earlier perspective and a concentrated account of the intervening
discoveries. The operator does not have to reconstruct that state manually for
every busy worker in a software factory.

Two benefits are hypotheses to evaluate separately:

1. **Context preservation:** keep earlier decisions available without carrying
   the entire intervening execution transcript into every subsequent turn.
2. **Fresh-context review:** inspect the actual implementation without inheriting
   its author's full recent narrative. The operator reports that this often
   exposes issues the implementation pass had overlooked.

This is not independent verification. A successor can share the same model,
earlier assumptions, and mistakes conveyed by the handoff. Findings still need
evidence; a confident handoff can itself anchor a mistaken review.

## The manual practice

1. The operator requests ordinary work: implementation, investigation, planning,
   or discussion. The last request before a long work episode is the intended
   conversation checkpoint.
2. The Agent works for a substantial period and eventually returns. Its recent
   context contains the discoveries, failed approaches, and implementation.
3. Before discarding that context, the operator asks it to write a detailed
   handoff for its earlier self, which will see today's files and Git history.
4. The operator forks the conversation at the checkpoint and adds the handoff
   instruction, or replaces the original task instruction with it while
   preserving the task's meaning. The working directory is not rolled back.
5. The successor reads the handoff, checks the current changes against the
   earlier requirements, and continues or corrects the work.

### Original handoff request

The following is the operator's manual prompt, preserved as a reference for
the intended behavior, not a Jig command or a normative prompt template:

```text
Let's say we could rollback our conversation/session to my last message before you had to spend so many hours on all these tasks.

What is the message you would like to have received at that moment, so that you would be awarded all the knowledge you gained in these last many hours of hard work, and that would have made you skip the bad work and go straight into the solutions?

Let's imagine you are handing the message to that older you, but that older you would have access to the current working directory rather than the one you had at the time. What is the most useful message that old version of you could receive? How would you present all the solutions you have just implemented? What should it know in order to continue the work where you are just leaving it now? Write it down at .tmp/time-travel-message.md - wipe it out first if any content is there.
```

The manual re-entry message is:

```text
I allowed an agent to go ahead first and give this plan a try. They made all the changes you can now see in the working directory and git history, and they also left you a handoff message at .tmp/time-travel-message.md
```

The mechanism does not depend on misleading the successor about authorship.
"A previous execution pass produced these changes; verify its conclusions"
preserves the intended review posture.

The single overwritten file is a convenience for one manual transition.
Automation needs distinct artifacts for different workers and checkpoints;
concurrent handoffs must not overwrite one another. Artifact naming and
retention are not selected by this brief.

## What goes back, and what stays current

| Material | Intended treatment |
| --- | --- |
| Conversation before the work episode | Retain its decision context, roles, and task meaning. |
| Long intervening execution transcript | Replace its contribution to active context with an explicit handoff. |
| Current files, artifacts, and Git history | Keep them current; identify what the successor actually reviews. |
| Later operator corrections or instructions | Carry them forward explicitly; do not lose them by restoring an earlier prefix. |
| Authority, budgets, completed effects, and uncertain operations | Preserve actual current state; the summary cannot recreate or widen authority. |

A fresh session seeded only with a summary misses the retained earlier
perspective. An ordinary whole-conversation summary also does not deliberately
preserve that prefix. A native fork and a reconstructed conversation may
preserve different client state; an implementation must disclose which it
provides and must not claim equivalence without evidence.

Restoring conversational context is neither a filesystem rollback nor replay
of the original request. Current uncommitted and concurrent changes also matter:
the successor must verify actual state instead of treating the handoff as an
atomic snapshot of the whole working directory.

## Automatic multi-Agent scenario

A factory has several workers carrying out authorized tasks. A policy observes
that one worker has crossed a threshold and arranges the handoff automatically.
The operator need not wait for the factory to finish or manually fork each
conversation. Other workers remain able to progress.

The intended sequence for the selected worker is:

```text
ordinary task work
    -> threshold observed; maintenance requested
    -> current task turn reaches an acknowledged stopping boundary
    -> handoff generated from the still-available recent context
    -> replacement context prepared from checkpoint plus handoff
    -> current instructions and unsettled work reconciled
    -> review and continuation of the same logical task
```

The threshold could use operations, elapsed work, or reported context usage.
Its value and meaning are application policy, not chosen constants here.
Elapsed time alone does not prove context pressure or poor work. A later proof
must distinguish the time of the request from the time a safe transition
actually becomes possible.

"Paused" means ordinary task advancement is suspended. The Agent may still
need to perform a handoff turn. Freezing its process would not let that same
process answer the handoff request. Nor does a cancellation request prove that
its tools or an already accepted remote operation have stopped.

## Coordination questions and required outcomes

These are observable requirements for the use case, not a selected event,
locking, or session API.

| Question | Required outcome |
| --- | --- |
| When can maintenance begin? | Establish a safe boundary for the targeted task; settle in-flight work or retain explicit uncertainty. Do not imply an instantaneous, side-effect-free pause. |
| Can several listeners act on the same event? | Observers do not gain mutation authority merely by receiving a notification. Competing requests have a defined disposition; listener order must not decide session state accidentally. |
| How is control passed? | At most one conflicting context transition controls a worker at a time. Duplicate triggers must not create duplicate successor tasks. Whether this uses a queue, lock, or another private mechanism is unresolved. |
| How is data passed? | Provide bounded, identified context and handoff artifacts. Preserve messages arriving during maintenance in a defined order; prevent stale decisions from overwriting newer instructions. |
| What happens elsewhere in the factory? | Independent workers continue within their budgets. Parent cancellation still settles all owned work, including maintenance; failure in one handoff cannot leak control over another worker. |

One accountable control owner per worker is a candidate design to evaluate.
It could serialize changes to that worker while allowing concurrency between
workers. This brief does not select a public owner object, semaphore, global
event bus, or listener registration interface.

## Failure and authority boundaries

- A stop or authority revocation that wins before continuation prevents
  continuation, even if handoff generation subsequently succeeds.
- Replacement is not visible as a half-updated conversation. Until a usable
  successor context is established, retain the prior usable state or stop
  explicitly. Failure must not cause silent context loss.
- Failure to observe, interrupt, fork, or reconstruct the selected client's
  session is an explicit unsupported or unsuccessful outcome, not a promise
  satisfied by a vaguely similar fresh prompt.
- Context replacement does not reset task deadlines, spending allowances,
  permissions, or already-consumed resources. Repeated triggers and queued
  messages need bounds; maintenance must not starve the task indefinitely.
- Possibly completed work is not redispatched merely because its transcript
  was removed. A timeout or coordinator loss must not leave old and successor
  workers both advancing the same task without an authorized concurrency rule.
- The handoff retains known uncertainty and references to execution evidence.
  Condensing active context does not establish permission to erase audit
  evidence or promises of indefinite transcript retention.
- Context can contain private source and credentials accidentally observed
  during work. Access to handoffs and any provider receiving them must remain
  within the operator's data policy; one worker does not inherit another's
  conversation or authority.

## Responsibility split

The supervising Flow owns the method: threshold policy, handoff instructions,
review steps, and decisions about continuing the task. A reusable handoff Flow
can supply that method without knowing the entire factory.

Jig owns enforcement across the host boundary: which work may be controlled,
data access, limits, cancellation, and cleanup. The Agent client or provider
supplies whatever conversation operations it actually supports. FLOW remains
the portable package and invocation boundary; this use case does not add a
FLOW method or make its internal orchestration Jig's scheduler.

The current [Agent Run contract](./spec/agent-run.md) and
[execution policy](./spec/project-policy.md) describe actual support. A finite
Agent call, its final result, or a cancellation channel is not evidence of
arbitrary conversation editing, live supervision, or parallel worker support.
The complete automatic use case is not an available alpha feature.

## Evidence to seek

Separate mechanism correctness from the claimed benefit to working with Agents.

**Mechanism proof:** retain a pre-task checkpoint, perform work, obtain the
handoff, and review the current implementation from the earlier context.
Identify the exact conversation boundary, retained artifacts, current files,
and client behavior. Check that task effects are not replayed and newer
operator instructions are preserved.

**Automatic coordination proof:** two workers are demonstrably active. A
controlled threshold causes one worker to hand off and continue while the other
makes progress. Exercise duplicate triggers, a message arriving during
maintenance, competing stop requests, failed handoffs, deadlines, and owner
loss. Verify bounded settlement, no lost input, no stale continuation, and no
owned execution residue. Returning to the same logical task is required;
silently launching a duplicate task is failure.

**Benefit evaluation:** compare with ordinary client condensation, a fresh
session given only a summary, and the operator's manual fork-and-handoff
procedure. Hold the task, available evidence, model, tools, and effective
budgets comparable. Select metrics before running the comparison: preservation
of earlier decisions, evidence-backed defect findings and false findings,
repeated work, operator interventions, latency, and cost. Do not count an
additional confident critique as a verified improvement.

The method's quality hypothesis fails if it loses important context or merely
adds calls without improving the selected outcome. Its Jig-specific value is
unproven if a client-native feature or small application controller provides
the same behavior and authority boundary with less burden. Neither result
justifies tuning indefinitely or declaring a universal compaction mechanism.

## Open decisions and exclusions

Before implementation, establish which client operations are actually
available, how a checkpoint is selected and retained, what triggers maintenance,
how pending messages and work are reconciled, and how failed maintenance is
reported or retried without replaying task effects.

This brief does not approve a provider registry, arbitrary transcript editor,
cross-project Agent administration, general event system, durable workflow
engine, public locks, or automatic restart after uncertain dispatch. It does
not make these capabilities prerequisites for every software-factory slice.
The manual pattern, automatic supervision, and improved review quality are
separate evidence gates, not interchangeable claims.

# Agency — Jig

**Agency** is Jig's core idea: the practical ability to pursue a purpose and
accomplish useful work. Its product promise is **power under control**.

Jig is a host: it runs reusable Flow packages with powers supplied by their
operator. People, applications, and software subsystems can use it. It serves
the shared aspiration to [expand human possibility](purpose.md) without
requiring a human at every interface.

## Guiding principles

Agency depends on capability and meaningful direction working together.

1. **Expand useful power.** Let consumers accomplish more by delegating to
   capable methods and combining their work.
2. **Keep direction with the authority owner.** Intelligence may exercise
   delegated powers; it cannot grant itself more.
3. **Make control usable throughout the work.** Consumers must be able to
   understand, constrain, observe, stop, and adapt the systems they rely on.

## 1. Expand useful power

Power comes from being able to assemble and invoke capable specialists. A
consumer can delegate investigation, building, checking, or revision without
implementing every method or adopting its author's entire stack. It can
combine methods into a process more useful than any one response.

Control makes that delegation practical: choose the work, constrain its
powers and resources, observe its outcome, intervene, and stop it. A system
that only restricts work has fulfilled half the promise. One that expands
execution without meaningful direction has also fulfilled only half.

A physical jig guides tools toward repeatable work without becoming the thing
being made. Jig similarly helps builders construct and refine their builders.
Applications retain purpose and domain policy; Jig supplies the authority and
lifecycle necessary to put their chosen methods to work.

An Agent is an intelligent worker used by a method; a Flow can coordinate one
or several such workers alongside ordinary code and checks. Jig makes this
work available under a common host boundary while leaving each method's
internal control and each application's purpose to its author.

## 2. Keep direction with the authority owner

Delegation, local admission, and method selection are different decisions.
Each must preserve the authority under which the work exists.

### Delegation for human and software consumers

A software subsystem can use Jig to pursue a delegated task within established
authority. Human possibility is the larger aspiration, not a requirement that
every caller or decision-maker be human. Policies can authorize bounded work
in advance; ordinary automation should not require repeated human approval
of decisions already delegated. Delegated work should receive the powers needed
for its task, not everything its caller can access.

The relevant distinction is between exercising authority and acquiring more
of it. A model can propose, create, criticize, and select within permitted
alternatives. Its output remains data until authorized policy acts on it.
Neither a persuasive answer nor successful completion creates permission to
publish, deploy, delete, purchase, communicate, or make another consequential
decision. Such action requires the real owner's authorization, which can be
explicitly delegated.

This is the separation of intelligence from authority. It preserves flexible
reasoning without making a model's judgment the source of its own powers.

### Methods travel; authority is supplied locally

Jig discovers and reviews methods before admission: the local decision to
authorize an exact revision and its configuration for execution. Finding,
downloading, parsing, or ranking a method does not admit it. Jig resolves the
accepted work and supplies its configured powers, limits, and lifecycle.
Later source changes do not inherit that authority silently.

The operator is the person or organization responsible for the host's powers.
They choose Agents, providers, endpoints, models, credentials,
infrastructure, containment, and data policy. A Flow can supply bounded task
instructions and the context and Skills appropriate to a particular Agent
call. That customization does not entitle it to select the operator's provider
or security posture. Those choices remain the operator's when a Starter
supplies the application too.

Host control is not a promise that all data stays on the host. A remote Agent
receives the bounded data intentionally sent to it. Its suitability and data
policy must be considered by the responsible operator. Exact admission proves
neither an Agent's truthfulness nor a package's safety under every threat.

### Flexible choice within exact boundaries

A growing set of useful methods should not require a hardcoded keyword gate
or a permanent graph connection for each possible method. Intelligence can help consumers choose an appropriate
procedure as that set grows. It need not control the set itself.

The governing sequence is:

```text
intent
    -> deterministically admitted, compatible, available, policy-eligible set
    -> optional semantic choice or abstention
    -> validation against that closed set
    -> exact invocation
    -> evidence and validated outcome
```

Workflow identities and model choices are data. A chooser cannot create a
target, provider, permission, or route by naming it. Compatibility is checked
before semantic preference, and uncertainty can result in abstention.

Explicit composition must remain excellent. Semantic choice earns its place
only when it offers a material advantage over an explicit route. This
principle protects dynamic choice; it does not select a general catalogue or
router implementation. Broader discovery remains an evidence-gated question.

## 3. Make control usable throughout the work

Control must remain effective after the initial decision to run something.
Failure, source changes, and everyday configuration all test that promise.

### Completion, cancellation, and uncertainty

Receiving a plausible result is not enough to finish work. Every effect and
live resource needs an owner. Completion and cancellation must account for
owned work through fencing (revoking further authority and stopping locally
owned execution) and cleanup, including when the coordinator fails. Missing
support fails visibly. Possibly dispatched work is not guessed successful or
silently repeated to conceal uncertainty.

These promises have to be proved under a stated threat model. They do not
imply that cancellation retracts a remote request already accepted by a
provider or undoes a completed external consequence. Exact execution does not
make an intelligent method semantically deterministic.
The [maintainer guide](../maintainer-guide.md) develops these obligations into
an operational model.

### Source that can be understood and changed

Control also requires understandable change. Visible user-owned source and
policy remain ordinary and editable. Mutable source proposes; exact accepted
meaning executes. This avoids choosing between opaque dependencies and edits
that silently acquire authority. Internal evidence need not be stored as
user-facing files merely because source ownership is file-oriented.

If project updates are earned, reconciliation should compare accepted base,
local intent, and upstream source, preserving unambiguous changes
deterministically before asking Agents to interpret conflicts or semantic
drift. Agents should resolve ambiguity rather than reconstruct mechanically
knowable edits. The effective source must remain visible, without a competing
runtime patch overlay; preserving intent does not mean every local edit can
be reconciled automatically.

### Ownership and simplicity make control usable

Ownership supports agency through practical abilities: inspect, understand,
adapt, replace, and retain the system doing the work. Source availability alone
does not make those abilities usable. Configuration burden, opaque effective
state, or dependence on one provider can make nominal control ineffective.

Sane defaults therefore matter. A Binding customizes and pins a use; it is not
mandatory plumbing for every component. A file for nearly every dependency is
a warning that ordinary composition has become needlessly difficult. Defaults
can simplify discovery and configuration without granting trust automatically.

A Starter is one coherent application copied and owned by its user. It
supplies useful structure and domain policy without becoming an algebra of
policy fragments or overriding operator choices. End users should experience
its purpose rather than manage Jig's internal lifecycle vocabulary.

Jig remains useful as OSI-approved open-source local software. Commercial
products must not turn it into a deliberately crippled community edition.
This is an ownership commitment supporting power under control, not a claim
that every deployment is local or every supporting service is free.

# Jig and FLOW product compass

Start here to recover the project's direction. The [doctrine](doctrine/purpose.md)
preserves the deeper reasoning; this file is its concise summary and reading
map. Neither is an API specification or a claim about what has shipped.

## The one-minute memory

The shared aspiration is **Expand human possibility**. The practical ambition
is to make useful capability accumulate and become available for further work:
**build the builders**, then let others inherit and improve their methods.

| Project | Core idea | Contribution |
| --- | --- | --- |
| **FLOW** | Capability compounding | Executable know-how that others can apply, evaluate, adapt, and share |
| **Jig** | Agency | Power under control: accomplish more through capable methods while retaining meaningful direction |

Portability enables FLOW's purpose; it does not guarantee improvement. Jig's
agency includes people, applications, and software subsystems. Ownership,
replaceability, and exact authority support its promise. Automation can act
within delegated policy without a person deciding at every step or a model
granting itself additional powers.

> FLOW carries meaning. Jig carries authority and lifecycle. Flows carry
> method. Runtimes carry internal control. Applications carry purpose.

The intended experience is approachable reuse: understand a method, accept it,
supply local powers, combine it with other work, inspect its outcome, and adapt
it. End users should meet a coherent application rather than kernel machinery.
The software factory is our north-star demonstration, not Jig's domain model.

## Essential commitments

The doctrine explains why these commitments matter and the tradeoffs they
require. Together they protect useful work under meaningful direction.

- **FLOW remains independent.** Its packages and invocation meaning do not
  require Jig's host policy or a privileged runtime.
- **Intelligence does not grant authority.** Discovery and model selection
  cannot authorize work. Compatibility and admission precede semantic choice;
  one exact accepted meaning executes.
- **Powers have an owner.** Operators supply providers, credentials, limits,
  and execution policy. Work can act only within authorized consequences.
- **Control survives failure.** Owned work must be accounted for through
  completion, cancellation, and cleanup. Missing support and uncertainty stay
  visible; a plausible answer is not sufficient proof of success.
- **Ownership is usable.** Source and policy remain inspectable and adaptable,
  with no hidden competing effective source. Jig stays useful as an
  OSI-approved open-source local product, not a crippled community edition.
- **Methods and applications stay outside the kernel.** Runtimes own internal
  control; Flows and applications own their methods, domain rules, and purpose.
- **Simple use stays simple.** Defaults handle ordinary use. Configuration,
  Bindings, contracts, and public abstractions must earn their burden.
  Minimalism removes unnecessary machinery, not proved safety invariants.
- **Claims follow evidence.** Independent use must establish the benefits
  claimed. Completing a phase does not authorize the next subsystem.

## Read the reasoning

Each chapter owns a distinct part of the product judgment. Read the relevant
one when a decision needs more than the summary.

| Chapter | Question it answers |
| --- | --- |
| [Purpose](doctrine/purpose.md) | Why should capability accumulate, who benefits, and what would a successful ecosystem enable? |
| [FLOW](doctrine/flow.md) | How can executable know-how compound, and why does an independent method boundary matter? |
| [Jig](doctrine/jig.md) | How does agency become power under control for human and software consumers? |
| [Design judgment](doctrine/design-judgment.md) | Which responsibilities, tradeoffs, proof standards, and lessons keep the design coherent? |

Chosen values explain what we serve. Product hypotheses describe benefits we
must demonstrate. Design commitments describe the boundaries we currently
choose to protect those values. An aspiration cannot prove a hypothesis or
make a particular mechanism inevitable. Unresolved questions stay unresolved.

## Returning as leader

Protect the order: useful reusable work and agency first; ownership and exact
authority make that power governable; FLOW, Jig, runtimes, and applications
each do their part. Enforcement machinery serves these outcomes.

Before expanding the product, use the
[decision test](doctrine/design-judgment.md#warning-signs-and-the-decision-test):
identify a valuable outcome and its strongest simpler alternative, find the
smallest responsible owner, expose authority and failure behavior, and name
the evidence and stopping rule. A complete application must justify its
ceremony on the advantage it claims, not win every possible comparison.

The [engineering re-entry guide](maintainer-reentry.md) owns stable engineering
memory; the [roadmap](ROADMAP.md) owns outcome order. Public specifications and
conformance evidence establish exact contracts; Git, current automation,
published artifacts, and observed behavior establish present state. Historical
proposals and the doctrine cannot silently change those contracts.

> Protect the boundary, but sell the outcome. Let methods remain creative,
> models remain replaceable, source remain owned, applications remain
> opinionated, and Jig remain the smallest authority that makes portable
> agentic work trustworthy.

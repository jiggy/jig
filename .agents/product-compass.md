# Expand human possibility

**Jig and FLOW product compass.** This is the entrypoint to what the projects
are for, the principles that govern them, and the decisions those principles
constrain. No project history or prior discussion is required.

## Core ideas

The shared aspiration is to make useful work achievable for more people.
Two complementary products pursue it.

| Project | Core idea | What it enables |
| --- | --- | --- |
| **FLOW** | Capability compounding | Executable know-how that others can apply, evaluate, adapt, combine, and share |
| **Jig** | Agency | Power under control: accomplish more through capable methods while retaining meaningful direction |

FLOW is an independent standard for reusable procedures, called Flows. Jig is
a host that runs those methods with powers authorized by their operator.
Jig's consumers can be people, applications, or software subsystems.

The pyramid widens from these ideas into increasingly specific decisions:

```text
                     Expand human possibility
              FLOW: Capability compounding | Jig: Agency
                     Guiding product principles
            Design commitments and responsibility boundaries
         Specifications, roadmap choices, and operational work rules
    Implementations, configurations, examples, experiments, individual edits
```

FLOW and Jig are sibling branches. Lower levels must satisfy every applicable
higher-level commitment. More detail does not create permission to contradict
the core ideas, and a core idea is not an excuse to bypass its safeguards.

## Guiding principles

The [shared purpose](doctrine/purpose.md) calls for capability to accumulate,
remain under its recipient's direction, and produce useful outcomes. Each
product expresses those principles in its own domain.

| FLOW — capability compounding | Jig — agency through power under control |
| --- | --- |
| Accumulate usable capability | Expand useful power |
| Keep methods independently reusable | Keep direction with the authority owner |
| Keep methods understandable and adaptable | Make control usable throughout the work |

Portability enables compounding without guaranteeing improvement. Agency
includes delegated software work without granting a model the power to
authorize itself. Ownership and replaceability make control practical.
These principles are developed in the [FLOW](doctrine/flow.md) and
[Jig](doctrine/jig.md) branches.

For Jig, usable control includes understandable review and results, and
user-friendly errors that explain the failure and the next safe step.
Opaque diagnostics undermine agency even when enforcement is correct.

## Design commitments

The wider [design layer](doctrine/design-judgment.md) develops three duties:
place responsibilities with their proper owner, preserve the promise with
the least burden, and let evidence bound the next decision.

### Responsibilities stay distinct

FLOW remains independent of Jig's host policy and every runtime's internal
control. Flows own methods; runtimes own their live advancement; applications
own purpose and domain rules. Operators supply Agents, credentials, limits,
and execution policy. No package or chooser acquires those powers by naming
them.

### The promises remain intact

Discovery is not admission: accepting a method authorizes exact reviewed
meaning, not any later edit. Compatibility and admission precede optional
semantic choice: model-assisted selection among eligible methods. Completion,
cancellation, and cleanup must account for owned work; missing support and
uncertainty remain visible.

Source and policy stay inspectable and adaptable without a competing hidden
effective source. Jig remains useful as an OSI-approved open-source local
product, not a crippled community edition. Defaults simplify ordinary use.
A Binding is a reusable project-local configuration for a Flow; such
configuration and formal contracts earn their burden through meaningful
customization or interoperability. Minimalism never removes proved safeguards.

### Evidence limits the next step

An independent consumer must establish the advantage claimed. The software
factory—a coordinated process producing reviewed code changes—is the demanding
north-star example, not Jig's application ontology.
A complete application must justify its added ceremony against a strong
simpler alternative on the dimensions it claims; it need not win every
comparison. Completing one outcome does not authorize the next subsystem.

## From commitments to concrete work

Specifications define exact public contracts within this doctrine.
The [maintainer guide](maintainer-guide.md) teaches the engineering model;
the [roadmap](ROADMAP.md) orders outcomes; implementation and conformance
evidence show what works. These lower layers realize the principles above,
rather than redefining them.

Chosen values, testable product hypotheses, and revisable design commitments
have different evidence needs. That distinction does not change their order
of authority. An aspiration cannot prove a benefit or select a mechanism.

The [decision test](doctrine/design-judgment.md#the-decision-test) begins with
the higher-level commitments a choice must satisfy. If a contract or proposal
conflicts with them, the affected work needs explicit resolution at the owning
level. Neither silently changing an API nor following a known contradiction
is a valid way to resolve it. The binding decision procedure is in the
[root instructions](../AGENTS.md#product-authority-and-entry-path).

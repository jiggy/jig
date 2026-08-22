# Decision matrix (working document)

This document records the live disputes. A row is not closed until the chosen
option has a protocol rule, a failure rule, and a conformance test.

| Decision | A | B | C | Decisive test |
|---|---|---|---|---|
| Executable discovery | `FLOW.md` argv | `flow.json` argv | one `flow[.ext]` plus a FLOW-owned runtime directive | Can Deno-only code fail before launch on a Bun-only host without creating a second authoritative entrypoint? |
| Shebang basis | rely on OS `#!` | reject shebang entirely | parse a FLOW-defined `#!flow <runtime-id>` directive | POSIX does not specify `#!`; portability must come from FLOW's grammar or explicit argv, not a false POSIX claim. |
| Host operations | per-operation protocol extensions | generic `effect/call` binding gateway | direct ambient APIs | Can a small host reject unsupported authority uniformly while Jig journals and policy-checks every mediated operation? |
| Facts and observation | one `event` channel | durable facts behind an event-store effect plus lossy trace | acknowledged fact events plus lossy telemetry | Can listeners react without allowing a dropped progress update to change correctness, and can a small host state its durability honestly? |
| Long-lived providers | include in Run core | separate stable Service module | separate experimental Service module | Can a Run-only host remain conforming while Jig and Cordis interoperate at launch with stable lifecycle semantics? |
| Lifetime vocabulary | publish Run, Scope, Context, Mount | publish Run/Mount; Context SDK-only; Scope internal | publish only Run | Does each public identity enable an operation that cannot be safely derived from the live request tree? |
| Project configuration | one root config | modular Flow Bindings | environment inheritance | Can one package have two immutable configurations without hidden precedence or a new expression language? |
| Semantic routing | optional add-on | mandatory LLM Router | mandatory deterministic Resolver with optional semantic selector | Does missing/ambiguous state remain diagnosable and repairable without an Agent while semantic choice stays available? |
| Missing dependency | fail permanently | silently generate and continue | pending diagnostic plus explicit staged repair policy | Can repair satisfy an as-yet-undispatched child call without rewinding executed work or running unvalidated code? |
| Sandbox | protocol mediation only | one claimed universal sandbox | common grant model compiled by honest platform backends | Can direct I/O bypass be prevented and can an incapable host fail closed without losing Run conformance? |
| Mutable source | execute working files | runtime patch overlay | activate immutable snapshots from editable source | Can edits and updates avoid changing active Runs while remaining directly understandable to users? |
| Update | Agent rewrites | deterministic three-way merge only | three-way merge, checks, optional Agent repair/review | Are exact nonconflicting edits preserved while semantic ambiguity remains explicit? |
| Filesystem role | universal Work/Space ontology | no file concepts | named file roots as optional grants plus project adapters | Can GUI/service applications avoid a fake Task/Workspace while coding Agents still receive isolated files? |
| Contract format | bespoke FLOW IDL | OpenRPC canonical profile | media-type-neutral descriptor | Can independent providers be verified today without freezing lifecycle/event semantics into a method-schema format? |

## Candidate cross-layer model

The current synthesis under attack is:

```text
FLOW Package/1
    semantic document and obvious optional implementation

FLOW Run/1
    one finite invocation; child calls; mediated effects; fact/trace output;
    request cancellation; no graph mirroring

FLOW Service/1
    separately conforming long-lived provider lifecycle; implemented by Jig
    but not required of small Run-only hosts

Jig runtime
    request ownership, resolver, binding snapshots, effect/event journals,
    scheduler, process supervision, sandbox backend, immutable activation

Jig project layer
    source catalogue, modular Flow Bindings, Hooks, provenance, updates,
    optional Agents and semantic/missing-dependency maintenance

Starters
    Task, inbox, Kanban, Git, GUI, and other application policy
```

The synthesis is rejected if any of these are true:

- an executable's runtime cannot be determined before it has effects;
- a third-party Run host must implement long-lived service semantics;
- a Flow can forge authority or ownership by supplying an identifier;
- an external effect with unknown completion is automatically replayed;
- a dropped observation can change required control flow;
- a SemanticRouter is asked to decide protocol, permissions, or trust;
- untrusted code can bypass a claimed restriction;
- saving or updating source mutates an active revision;
- a local customization exists in two authoritative representations;
- a project-level feature becomes mandatory FLOW metadata.

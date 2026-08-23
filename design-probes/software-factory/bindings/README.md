# Why this probe has several Bindings

A Binding is not an import. It is one named, reviewable execution or authority
configuration. The probe keeps one declaration per file so its basename is the
Binding ID and an authority change has an obvious home.

| Group | Bindings | Why they cannot be one object |
|---|---|---|
| Application | `kanban`, `triage` | Distinct Service and Run lifetimes with different dependency surfaces. |
| Child Flows | `reference-fast`, `reference-deep`, `create-missing-flow` | Separate implementations, candidates, and staging authority. |
| Agent roles | `analysis-agent`, `work-agent`, `repair-agent` | No workspace, shared writable workspace, and repair-only workspace are materially different ceilings. |
| Host seams | `semantic-choice` | One replaceable ranker configured through the analysis Agent. |

The number is intentionally visible. Combining these declarations into one
large file would reduce filenames but not the normalized Bindings or trust
decisions. A smaller application should have fewer Bindings; Jig should not
require one merely to describe an unconfigured package in `flows/`.

This probe has nine Bindings: five configure its five used FLOW packages and
four configure non-Flow capabilities (three distinct Agent authority roles and
one Semantic Choice ranker). Bindings therefore need not be fewer than Flows;
they count configured uses, not package definitions. The two former
watcher/Journal Bindings were incidental glue and have been removed.

The inbox watch is absent from this directory because its one-use registered
Event Source is owned directly by `hooks/on-inbox-item.ts`. A reusable or
portable producer shared by several Hooks would instead earn its own Service
Binding and Journal dependency.

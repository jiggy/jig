# Why this probe has several Bindings

A Binding is not an import. It is one named, reviewable execution or authority
configuration. The probe keeps one declaration per file so its basename is the
Binding ID and an authority change has an obvious home.

| Group | Bindings | Why they cannot be one object |
|---|---|---|
| Application | `inbox-watcher`, `kanban`, `triage` | Distinct Service/Run lifetimes and attachments. |
| Child Flows | `reference-fast`, `reference-deep`, `create-missing-flow` | Separate implementations, candidates, and staging authority. |
| Agent roles | `analysis-agent`, `work-agent`, `repair-agent` | No workspace, shared writable workspace, and repair-only workspace are materially different ceilings. |
| Host seams | `journal`, `semantic-choice` | Different contracts and grants; neither is runnable. |

The number is intentionally visible. Combining these declarations into one
large file would reduce filenames but not the normalized Bindings or trust
decisions. A smaller application should have fewer Bindings; Jig should not
require one merely to describe an unconfigured package in `flows/`.

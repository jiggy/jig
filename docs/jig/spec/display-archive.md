# Retained application views

*Status: experimental source candidate.*

An application can deliver one finite display bundle for explicit local retention.
A bundle contains ordinary semantic views, not execution history or executable UI.
[Reporting](reporting.md) owns those views and their portable validation.
The application owns domain state, projections, instance keys and editions.
Jig owns verified capture, atomic acceptance, evidence binding and local retention.
This contract adds no FLOW operation, automatic replay, daemon or browser mutation control.

## Select final material

Use `createDisplayBundle(context, options)` and `encodeDisplayBundle(bundle)` from `@jigging/reporting`.
Python exposes equivalent `create_display_bundle` and `encode_display_bundle` helpers.
These pure helpers perform no filesystem operations.
Write the encoded document through an ordinary declared output attachment or artifact result.
The operator or approved application entrypoint must select that output explicitly:

```sh
jig run --display-bundle files=display.json
```

`NAME` names a declared read-write attachment or artifact result.
`FILE` is a safe relative path within that output.
Only one `--display-bundle NAME=FILE` selection is accepted.
A filename, JSON field or optional live report cannot select publication implicitly.

The selected bundle requires verified final delivery after confirmed execution settlement and project closure.
Checkpoint delivery cannot publish a final edition.
Jig never substitutes the last live snapshot or invokes another Flow after the handler returns.
Publication does not change the domain result or establish application success.

The finite bundle contains these closed fields:

| Field | Meaning |
| --- | --- |
| `kind` | Exactly `display-bundle`. |
| `requestId` | Application-selected identity for one publication request. |
| `generation` | Opaque current archive generation from publication context. |
| `edition` | Application-selected label for the finite material. |
| `views` | One to 32 selected view entries. |
| `requiredEvidence` | Optional references whose retention is required for acceptance. |

Each entry contains `view`, `expectedRevision`, `completeness` and optional `domainRevision`.
Every view requires `target: {definitionId, instanceKey, subjectKey?}`.
The pair `definitionId` and `instanceKey` selects one retained projection.
`subjectKey` optionally relates navigation across definitions without merging contents or publisher identities.
View IDs and target pairs must be unique within the bundle.
Only one view may nominate a landing hint.

`completeness` is the application's `complete` or `partial` claim.
`domainRevision` is an opaque application claim, separate from the archive's concurrency revision.
Jig cannot determine currency against current domain state without a current application revision.
Retained presentation therefore reports currency as unknown.
Acceptance receipts establish acceptance-time facts, not continuing evidence availability or domain correctness.

The helpers derive each `expectedRevision` from the supplied context, including removal fences.
A missing target receives `null`, meaning it has never existed in that archive generation.
Authors need no patch language, event replay or publication callback.
The same pure projection functions can supply live updates and final bundle material.
A display-only Flow is valid when its declared purpose and outputs require no other domain effect.

## Publication context and commands

Commands operate on the current project's protected `.jig/display` archive.
The project must already have an owner-only `.jig` directory.
These commands do not evaluate project source, acquire execution authority, read credentials or contact providers.

```sh
jig views context --json
jig views list --json
jig views list --definition photos --instance family-2025 --display web
jig views receipt --request publication-1 --generation ARCHIVE_GENERATION
jig views remove --definition photos --instance family-2025 --expected-revision TARGET_REVISION
jig views reset --generation ARCHIVE_GENERATION
```

`jig views` defaults to `list`.
`context` creates the presentation archive when absent and returns `{generation, heads}` as JSON.
Each head contains `definitionId`, `instanceKey`, `revision` and `retained`.
Removed targets remain in context with `retained: false` until reset.
Pass that context to the application through its ordinary declared input or read attachment.
Context neither supplies domain state nor authorizes domain effects.

`list` accepts optional `--definition`, `--instance`, `--display plain|web` and `--json`.
`--instance` requires `--definition`.
Plain human output lists titles, summaries, editions and completeness.
JSON or redirected stdout returns generation, matching heads, matched and omitted counts, and bounded retained views.

Selection filters apply before payloads are loaded.
Reads return at most 32 views within 6 MiB and disclose omissions.
A concurrent archive change rejects presentation instead of combining different snapshots.
Explicit web requires terminal stderr and uses the authenticated [web display](web-display.md) boundary.
It presents application views without invented calls, activity history or execution duration.
The browser cannot publish, remove, reset, rerun or modify domain work.

No TUI mode is provided for this command.
`receipt` requires both the original request identity and generation.
It returns the original receipt as JSON, or `null` with exit 1 when absent.
An expired generation rejects lookup instead of resolving a reused identity in another generation.

`remove` requires the exact current target revision.
`reset` requires the exact current generation and clears retained material, receipts and removal fences.
Reset returns a new opaque generation.
Both mutations reject stale conditions rather than guessing the caller's intent.

## Atomic acceptance and recovery

Jig accepts all selected views and their evidence bindings in one transaction.
Each expected target revision must match, including targets previously removed.
A mismatch rejects the whole edition and preserves existing material.
Retained views are derived application projections, not the application's database.
Jig does not aggregate unrelated Runs or infer precedence from arrival time.
The application must compose child results deliberately into its root projection.

Jig binds the captured bundle to its actual Run and root publisher.
Authored target keys, view IDs and labels cannot impersonate that source.
Equivalent material under an accepted request identity returns the original receipt and provenance before revision checks.
This recovery does not create another contribution or restore material removed after acceptance.
Changed material under that identity rejects.
A reset expires old requests and prevents publication into another generation.

The receipt records generation, request, edition, target revisions, publication digest, captured bundle digest, source and evidence outcomes.
A lost or late acknowledgment does not establish rejection.
Inspect the original receipt before deciding whether another publication is needed.

The CLI joins its original acceptance operation and cleanup instead of abandoning an unresolved write.
Publication and delivery share the existing finite completion allowance.
Allowance expiry after committed acceptance cannot retract that acceptance.
Unconfirmed publication produces a separate diagnostic and command failure without replacing known execution or delivery facts.

## Exact evidence

Only typed references can request retained evidence.
Output references resolve against the selected Run's verified delivered attachment or artifact result.
Input references resolve against exact members of its immutable captured input set.
A relative filename or matching attachment name cannot borrow another publisher's evidence.
Children must return and explicitly remap evidence through the root application's ordinary outputs.

Record references can retain a supplied same-bundle record.
Execution history is not retained, so call references remain unavailable.
Missing, unobserved or over-budget evidence remains explicitly unavailable.
A `requiredEvidence` reference must occur in a published view.
Its unavailability rejects the complete edition.
Other unavailable references do not discard otherwise valid views.

Jig verifies retained content digests before exposing bytes again.
Preview and download access use exact captured identities and generations.
They never reopen original input paths, mutable destinations or external URLs.
Inspection retains at most 64 evidence files within 64 MiB.
Downloads retain the shared 16 MiB per-file limit and remain independent of clipped previews.
Close releases presentation captures and owned preview processes.

## Finite profile

| Resource | Bound |
| --- | --- |
| Canonical bundle, excluding one framing LF | 4 MiB |
| Views per edition | 32 |
| Required evidence references | 256 |
| Evidence items per publication | 4,096 |
| Evidence content per item / publication | 16 MiB / 64 MiB |
| Accepted request identities per generation | 1,024 |
| Target identities, including removal fences | 4,096 |
| Logical archive storage | 256 MiB |
| One scoped view read | 32 views / 6 MiB |
| One receipt | 8 MiB |

Individual views retain reporting's 512 KiB item limit and semantic bounds.
The storage allowance covers logical material, not guaranteed free disk space or a hard filesystem quota.
Receipts retain bounded acceptance history even when replacement or removal releases obsolete evidence bytes.

Capacity exhaustion refuses new publication.
Jig never evicts request identities silently and permits an explicit generation-checked reset.
Unsafe or incompatible storage fails closed without automatic repair or format migration.
Source checks and design agreement do not establish installed-host or native qualification.

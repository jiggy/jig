# Jig Project Authoring SDK/1

**Status:** closed private candidate for the package-authoring slice. It is not
an npm publication claim and does not define Jig administration.

Project Authoring SDK/1 is the small inert TypeScript projection used by
`jig.ts` and package Binding declaration files. Its values express desired
state only. Evaluating them cannot discover files, resolve packages, grant
authority, install providers, apply a candidate, or start work.

## 1. Public surface

```ts
import {
  bindingRef,
  candidates,
  defineBinding,
  defineJig,
  defineJournalPublisher,
  discover,
  flowRef,
  projectRunTargets,
} from "@jigging/jig";
```

No live host-control method is exported from this authoring surface.

### `defineJig`

```ts
export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
```

Each field is independently optional. A field accepts either `discover()` or
an exact array of member paths. Omission means no source of that kind. The
containing field determines whether members are Flow package directories or
Binding declaration files.

Discovery is shallow and inert. Under a `flows` root it selects immediate
child directories containing exact-case `FLOW.md`; under a `bindings` root it
selects immediate regular `*.ts` files. It does not recurse, follow symlinks,
execute declarations, or interpret globs. A missing valid discovery root is an
empty source. Binding identity is the declaration filename's LocalName
basename (`bindings/review.ts` has ID `review`); there is no duplicate `id`
field. Complete path, collision, capture, and admission rules are in
[`project-policy.md`](project-policy.md).

### `defineBinding`

```ts
export default defineBinding({
  package: "./flows/review",
  settings: { maxRetries: 4 },
  slots: {
    research: candidates([
      flowRef("./flows/research-fast"),
      bindingRef("research-deep"),
    ]),
  },
  attachments: {
    source: "./workspace",
  },
});
```

`package` identifies an exact configured project catalogue member. Omitted
`settings`, `slots`, and `attachments` normalize to empty objects. A different
configuration is a different Binding; there are no profiles, inheritance,
overlays, environment fallback, or per-Run setting overrides.

`slots` accepts one tagged Flow or Binding target, `candidates()` containing
two or more tagged Run targets, or the explicit `projectRunTargets()` changing
source. Candidate order has no semantic precedence.
The authoritative normalizer rejects duplicate targets and incompatible slot
kinds after resolving package metadata.

`attachments` maps package-local attachment names to project-relative source
paths. Access mode and required names come from the package metadata. The
project cannot widen those declarations.

### References

```ts
flowRef("./flows/review")
bindingRef("strict-review")
candidates([flowRef("./flows/fast"), bindingRef("deep")])
projectRunTargets()
```

References are tagged plain data. Raw target strings are not accepted and one
namespace never silently wins over another.

`projectRunTargets()` means the complete structural Run-target catalogue of
the immutable project Candidate used for planning. It is expanded once,
reviewed, locked, and pinned with the admitted generation. It grants no
authority, chooses no route, invokes no model, and performs no author-time
discovery. A fixed `candidates([...])` list and this changing source remain
different identities even when their current expansions match. The marker is
valid only as a direct Flow-call slot value and cannot be nested in
`candidates()`.

Runtime filtering happens later against the pinned expansion. The current
private host can dispatch one surviving direct Flow or one narrowly
configuration-only Bun Run Binding; zero survivors dispatch nothing and
several survivors remain ambiguous. Agent ranking, recursive composition,
general configured Binding dispatch, and complete authority/resource/liveness
filtering are not claims of this authoring surface.

### `defineJournalPublisher`

```ts
export default defineJournalPublisher({
  eventTypes: [
    "https://example.org/events/work-created",
  ],
});
```

This is the one deliberately narrow trusted-host declaration in the current
candidate. It authorizes Jig's canonical Journal publisher for an exact,
non-empty finite set of Event type strings. Normalization sorts the set,
rejects duplicates, bounds each value to the Journal contract's 512-character
limit, and rejects Jig's protected `https://jig.dev/events/` lifecycle
namespace. It does not name a provider module, grant host authority, expose a
read API, or create a Run/Service activation target.

A package Binding maps its exact Journal capability slot in the ordinary way:

```ts
slots: {
  journal: bindingRef("publisher"),
}
```

where `bindings/publisher.ts` exports the publisher declaration. Admission
pins source identity `binding:publisher`, the canonical Journal contract, and
the exact Event-type set. Other host capabilities still have no authoring
surface.

## 2. Direct admitted Flow targets

A discovered Run package which is valid with `{}` settings, declares no
required capability use or attachment, and needs no Agent or instruction
mapping may be admitted directly without a Binding. It receives empty settings,
attachment, and Flow-call slot maps; an attempted undeclared child call ends
`BINDING_MISSING`. Aggregate approval is still required. Runtime availability
is planned separately, so an eligible direct target may be admitted
`UNAVAILABLE`.

Direct and Binding targets use one internal admitted-target execution path.
There is no hidden default Binding.

## 3. Helper behavior

All helpers are synchronous and side-effect-free. They return deeply frozen
plain data and reject:

- unknown keys;
- explicit `undefined` or `null` for optional object fields;
- functions, accessors, symbols, bigint, non-finite numbers, sparse arrays,
  cycles, class instances, and other non-JSON/1 values;
- invalid LocalNames and project paths; and
- candidate sets with fewer than two entries.

One leading `./` is removed from author paths. Output paths use `/` and are
project-relative. Paths are NFC Unicode-scalar strings bounded to 64 segments,
1,024 UTF-8 bytes total, and 255 UTF-8 bytes per segment. Discovery does not
accept a glob language.

Helper checks are ergonomic only. Jig evaluates the captured module in a
bounded, default-deny process envelope and independently normalizes the
result. The JavaScript realm itself is not an authority boundary and retains
engine nondeterminism; the OS envelope denies project, undeclared host-file,
host-environment, network, Service, and cgroup authority. Forged helper output
acquires no trust.

## 4. Captured authoring values

The machine schema is
[`machine/project-authoring-1.schema.json`](machine/project-authoring-1.schema.json).
It validates either one `defineJig()` value:

```json
{
  "flows": { "kind": "discover", "roots": ["flows"] },
  "bindings": { "kind": "discover", "roots": ["bindings"] }
}
```

or one normalized `defineBinding()` / `defineJournalPublisher()` value.
Authors do not add a redundant
`jig: 1` or `$schema` field to either declaration.

Schema/1 validates closed shape and local type/size bounds. The private staged
capture boundary is fixed in
[`108-project-capture-boundary.md`](../design-review/108-project-capture-boundary.md):
it must expand exact source membership, retain immutable package and declaration
bytes, and record provenance before resolution. It separately validates
LocalName and path grammar, collisions, dangling references, package
capabilities, settings schemas, attachment completeness, slot contract
compatibility, and direct-target eligibility. Diagnostics identify their
normalized JSON Pointer. The shape schema alone is never admission evidence.

## 5. Deliberate exclusions

Project Authoring SDK/1 does not expose Hooks, Service export references,
instruction Agent selection, `semanticChoice`, generic
host-capability Bindings, registration-defined grants, or runtime/sandbox
selection. Private Hook work uses a separately named experimental overlay and
machine schema; those are not members of SDK/1 and carry no compatibility
promise. The canonical Journal publisher above is an intentional
Journal-specific exception, not a provider SPI. Each remaining projection has an explicit unresolved
prerequisite. It deliberately never exposes administration APIs. Root
Administration/1 is a separate host-side control-plane candidate outside every
FLOW activation; it is not a project authoring or FLOW API.

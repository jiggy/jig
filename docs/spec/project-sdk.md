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
  discover,
  flowRef,
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

`slots` accepts one tagged Flow or Binding target, or `candidates()` containing
two or more tagged Run targets. Candidate order has no semantic precedence.
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
```

References are tagged plain data. Raw target strings are not accepted and one
namespace never silently wins over another.

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
bounded authority-free environment and independently normalizes the result.
Forged helper output acquires no trust.

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

or one normalized `defineBinding()` value. Authors do not add a redundant
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

Project Authoring SDK/1 does not yet expose Hooks, Service export references,
instruction Agent selection, `semanticChoice`, host-capability Bindings,
registration-defined grants, open catalogue views, runtime/sandbox selection,
or administration APIs. Their host semantics remain reviewed, but each public
projection has an explicit unresolved prerequisite.

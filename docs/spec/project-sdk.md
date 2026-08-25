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

A discovered Run package which is valid with `{}` settings and requires no
attachment, dependency, Agent, or instruction mapping may be admitted directly
without a Binding. Aggregate approval is still required. Runtime availability
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
project-relative. Discovery does not accept a glob language.

Helper checks are ergonomic only. Jig evaluates the captured module in a
bounded authority-free environment and independently normalizes the result.
Forged helper output acquires no trust.

## 4. Normalized capture

The machine schema is
[`machine/project-policy-1.schema.json`](machine/project-policy-1.schema.json).
A normalized aggregate contains:

```json
{
  "$schema": "https://jig.dev/schemas/project-policy-1.json",
  "project": {
    "flows": { "kind": "discover", "roots": ["flows"] },
    "bindings": { "kind": "discover", "roots": ["bindings"] }
  },
  "bindings": {}
}
```

`$schema` identifies the normalized machine document. Authors do not add a
redundant `jig: 1` field to `jig.ts`.

JSON Schema validates closed shape and local lexical bounds. The deterministic
semantic normalizer separately validates source membership, derived Binding
IDs, collisions, dangling references, package capabilities, settings schemas,
attachment completeness, slot contract compatibility, and direct-target
eligibility. Diagnostics identify their normalized JSON Pointer.

## 5. Deliberate exclusions

Project Authoring SDK/1 does not yet expose Hooks, Service export references,
instruction Agent selection, `semanticChoice`, host-capability Bindings,
registration-defined grants, open catalogue views, runtime/sandbox selection,
or administration APIs. Their host semantics remain reviewed, but each public
projection has an explicit unresolved prerequisite.

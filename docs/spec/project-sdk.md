# Jig Project Authoring SDK/1

**Status:** prerelease candidate.

Project Authoring SDK/1 is the inert TypeScript surface used by `jig.ts` and
Binding declaration files. Its values describe desired project membership and
configuration. They do not read files, install dependencies, grant authority,
admit a project, or start work.

## Public surface

```ts
import {
  defineBinding,
  defineJig,
  discover,
} from "@jigging/jig";
```

No administration, runtime, sandbox, event, Agent, or routing API is exported
from this surface.

## Project declaration

A bare project makes its defaults explicit:

```ts
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
```

`flows` and `bindings` are independently optional. Each accepts either a
`discover()` value or an exact array of project-relative member paths.
Omission means an empty source.

Discovery is shallow and inert:

- a Flow root selects immediate real directories containing exact-case
  `FLOW.md`;
- a Binding root selects immediate regular `*.ts` files;
- it does not recurse, follow symlinks, execute declarations, or interpret
  globs; and
- a missing valid discovery root is empty, while any invalid selected member
  rejects the complete project candidate.

Several roots may be supplied explicitly:

```ts
flows: discover(["./flows", "./vendor-flows"])
```

They form one unordered union. Duplicate, overlapping, escaping, symlinked,
case-fold-colliding, or NFC-colliding members are rejected.

An exact source is the fail-closed alternative:

```ts
flows: ["./flows/build", "./flows/review"]
```

## Binding declaration

A Binding configures one exact project Flow package:

```ts
import { defineBinding } from "@jigging/jig";

export default defineBinding({
  package: "./flows/review",
  settings: { maxRetries: 4 },
});
```

`package` is required. Omitting `settings` produces an empty object. Settings
must satisfy the package's `settings.schema.json` when one exists.

This alpha has no project attachment mapping. A selected FLOW package may
declare attachments as portable package metadata, but it cannot then be a
direct target, and a Binding which selects it rejects the complete project
candidate. Supporting attachment projection later must be an explicit host
feature rather than an inert authoring placeholder today.

Binding identity is the declaration filename's LocalName basename. For
example, `bindings/review.ts` has ID `review`. There is no duplicate `id`
field, profile inheritance, overlay, ambient environment fallback, or per-Run
settings override.

Bindings are optional. A discovered Run package which is valid with empty
settings and declares no attachment or capability use is also an
exact direct Flow target. There is no hidden generated Binding.

## Value rules

All helpers are synchronous and side-effect-free. They return deeply frozen
plain data and reject:

- unknown keys;
- explicit `undefined` or `null` for optional object fields;
- functions, accessors, symbols, bigint, non-finite numbers, sparse arrays,
  cycles, class instances, and other non-JSON/1 values;
- invalid LocalNames or project paths; and
- duplicate or colliding paths.

One leading `./` is removed from author paths. Output paths use `/`, remain
project-relative, and are bounded by the Project Authoring schema. Discovery
does not accept a glob language.

These checks are ergonomic only. Jig evaluates captured author modules inside
its bounded default-deny execution envelope, then independently validates and
normalizes their result. Forged helper output acquires no trust.

## Machine shape

The closed machine schema is
[`machine/project-authoring-1.schema.json`](machine/project-authoring-1.schema.json).
It validates either a normalized project value:

```json
{
  "flows": { "kind": "discover", "roots": ["flows"] },
  "bindings": { "kind": "discover", "roots": ["bindings"] }
}
```

or one normalized Binding value:

```json
{
  "kind": "package",
  "package": "flows/review",
  "settings": {}
}
```

Authors do not add a format discriminator or `$schema` field. Shape validation
alone is never admission evidence: Jig separately captures exact membership,
retains immutable package and declaration bytes, links references, validates
package schemas, derives the review delta, and admits only an explicitly
applied retained Plan.

## Deliberate exclusions

SDK/1 does not define child-Flow slots, candidate catalogues, semantic choice,
Hooks, Services, Journal publishers, Agent selection, generic grants, runtime
selection, sandbox selection, attachment projection, or administration. Those
concepts are absent from the direct alpha rather than represented by
placeholders.

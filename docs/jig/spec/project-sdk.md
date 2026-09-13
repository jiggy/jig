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

`flows`, `bindings`, and `grants` are independently optional. Each accepts either a
`discover()` value or an exact array of project-relative member paths.
Omission means an empty source.

Discovery is shallow and inert:

- a Flow root selects immediate real directories containing exact-case
  `FLOW.<ext>`;
- a Binding root selects immediate regular `*.ts` files;
- a grant root selects immediate regular `<LocalName>.json` policies;
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
  slots: {
    research: "flow:./flows/research",
    critique: "binding:critic",
  },
});
```

`package` is required. Omitting `settings` produces an empty object. Settings
must satisfy the package's `settings.schema.json` when one exists.

`slots` is an optional map with at most 256 entries. Each key is a LocalName
used by this Binding's package as a Run/1 `flow/call` slot. Each value is an
exact `flow:<project-relative-path>` or `binding:<LocalName>` selector,
an inline resource grant, or a `grant:<LocalName>` selection. Grant names
are slot selections, not CLI Run targets. A Flow selector requires a direct
Flow target; a Binding selector uses that Binding's own validated settings.
Either child may use the exact native Agent Run or Agent Exchange invocation; a configured Binding may
also use explicitly granted Project Command or HTTP slots. A selected Binding
must have no further Flow/Binding child routes; resource slots do not count
as child routes. A Binding cannot select its own package, directly or
through another Binding. Omitting `slots` normalizes to `{}`.
The example's `critic` Binding selects a separate package such as
`flows/critique`, with its own settings and no slots.

Slots are exact project links, not requests for later resolution. Project
review binds each slot to the named Flow or Binding target in the same candidate,
and admission retains that complete relation in one immutable generation.
Explicit Flow routes belong only to the Binding declaration: running the package
through its `flow:` identity never borrows them. Native defaults are resolved
from that target's own requirements.
Plain package paths are not slot selectors. A leading `./` after `flow:` is
normalized away; the `binding:` suffix must be a LocalName.

Resource policies are inline by default:

```ts
slots: {
  tests: { kind: 'command', test: ['test/project.test.ts'] },
  reference: { kind: 'http', url: 'https://docs.example.org/reference', method: 'GET' },
}
```

For reuse, select `reference: 'grant:documents'` and include
`grants: discover('./grants')` in `jig.ts`. The filename
`grants/documents.json` supplies the policy name; its object uses exactly the
same grammar as an inline grant. Each selected slot must declare the exact
supported contract for its resource kind. Both resource kinds permit eight
slots per Binding without increasing execution capacity.
[Grants](grants.md) owns capture limits and explicit authority approval.
Parent permissions are never inherited.

`attachments` optionally binds declared read attachments to project-relative
directories, for example `attachments: { decoder: "./tools/base64" }`.
Review captures those directories and includes their sources, content digests,
and complete file manifests in the proposed Binding. Approval pins those bytes;
Runs never reopen their originals. Names must match read-only declarations in
the selected Flow's `FLOW.contract.json`; unknown or writable selections fail.
Omission or an empty map selects nothing. A `flow:` target never borrows another
Binding's captured files. See [reviewed attachments](project-policy.md#reviewed-binding-attachments)
for bounds, retained storage and tool-bundle limitations.

Other read attachments remain per-invocation `--attach` inputs; a Run cannot
override a Binding's captured selection. Root Flows and Bindings use the same
[root file profile](project-policy.md#root-file-runs). Binding child slots
cannot select attachment-bearing packages or inherit parent file authority.

Binding identity is the declaration filename's LocalName basename. For
example, `bindings/review.ts` has ID `review`. There is no duplicate `id`
field, profile inheritance, overlay, ambient environment fallback, or per-Run
settings override.

Bindings are optional. A discovered Run package which is valid with empty
settings, fits the root attachment profile, and uses only the supported
[Agent Run](agent-run.md), [Agent Exchange](agent-exchange.md) and/or
[Run Checkpoint](run-checkpoint.md) contracts
(or no requirements) is also an exact direct Flow
target. There is no hidden generated Binding.

A required named invocation is declared by `uses.<slot>.contract` in package
metadata. The selected Flow must offer exactly that ID, version and digest
through its root `FLOW.contract.json`; anonymous ordinary calls need no contract.
Unmapped qualified Agent Run, Agent Exchange and Run Checkpoint slots
resolve to their native defaults. HTTP Request and Project Command require
explicit slot grants. Native authority cannot be
replaced by mapping a package that merely claims its contract identity.
Review shows expected contracts and selected routes together. See
[project policy](project-policy.md#5-bindings) for qualification and limits.

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
[`project-authoring-1.schema.json`](https://jig.md/schemas/project-authoring-1.schema.json).
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
  "settings": {},
  "slots": {}
}
```

Authors do not add a format discriminator or `$schema` field. Shape validation
alone is never admission evidence: Jig separately captures exact membership,
retains immutable package and declaration bytes, links references, validates
package schemas, derives the review delta, and admits only an explicitly
applied retained Plan.

## Deliberate exclusions

SDK/1 does not define dynamic child-Flow resolution, candidate catalogues,
semantic choice, Hooks, Services, Journal publishers, Agent selection, arbitrary
permission grants, runtime selection, sandbox selection, attachment projection, or
administration. A Binding's exact `slots` map includes its complete child-Flow
authoring surface; the excluded concepts are absent rather than represented by
placeholders.

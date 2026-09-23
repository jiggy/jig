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

No administration, execution, sandbox, event, or live routing API is exported
from this surface.

## Project declaration

A bare project makes its membership explicit:

```ts
import { defineJig, discover } from "@jigging/jig";

export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
});
```

`flows`, `bindings`, and `grants` are independently optional. Each accepts either a
`discover()` value or an exact array of project-relative member paths
(`flows` also accepts declared `npm:` package selectors).
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

### Default providers by contract

`defaultProviders` is an optional map of at most 256 contract IDs to exact
implementation selectors. It supplies ordinary implementations for omitted
slots requiring those contracts, independently of their local slot names:

```ts
export default defineJig({
  flows: discover("./flows"),
  bindings: discover("./bindings"),
  defaultProviders: { 'https://jig.md/contracts/agent-run': "binding:agent" },
});
```

Each selected package must offer a named `FLOW.contract.json` whose ID matches
the map key. Keys identify contracts; they are never fetched or executed.
In this example, `binding:agent` requires a local `bindings/agent.ts` included
by discovery. That file selects an existing Flow package and its configuration;
the default selector neither creates a Binding nor installs a package.
Keys are canonically ordered; each key selects one provider. The target's
actual contract, not the map alone, establishes compatibility.

Review resolves each target's omitted named requirements against these
selections. An explicit Binding slot wins. Otherwise the default must match
the required contract ID, version and digest exactly; a mismatch never falls
back to another implementation. An incompatible default makes an automatic
direct target ineligible; an omitted Binding slot with that mismatch rejects
the candidate. A correct explicit Binding override can still use the package.
Anonymous requirements always need explicit slots. Without an explicit selection,
review may select the sole structurally provisioned target offering the exact
required contract. Multiple matches require a project mapping or consumer slot;
runtime availability and credentials never break ties.

A selected default must itself be invokable, require no attachments, and use
an ordinary offered interface. A `flow:` selection requires a direct Run target.
HTTP Request, Finite ACP, Project Command and Run Checkpoint are host-only interfaces, not
eligible ordinary defaults. Selecting a provider does not grant powers: its own
Binding must still obtain explicit admission for any resource grants it uses.

Both direct Flows and Bindings receive their own reviewed, effective routes.
Admission retains those exact routes, not a map consulted at runtime. Agent
requirements need a matching ordinary implementation. Only qualified root Run
Checkpoint requirements may resolve implicitly to host-owned retention.

## Declared package targets

`npm:<package-name>` selects a Flow from a dependency declared in the Jig
project's `package.json` `dependencies`. It is valid in `defaultProviders`,
Binding `package`, Binding Flow slots, exact `flows` membership, and CLI Run or
inspection selectors. For example, `package: 'npm:@jigging/agent-acp'` configures
the dependency's own Flow. Names have no version or subpath suffix; the manifest
and Bun lock own dependency versions. The package must contain a valid FLOW
entrypoint and its own declarations; JavaScript exports are not invoked to
discover it. A library without a FLOW entrypoint is not a Flow provider.

Workspace dependencies use a captured workspace; the Jig application can be
its root or a declared member. Root dependency selection captures package metadata
and the selected dependency closure, not unrelated application files.
Workspace-root `patchedDependencies`
may select captured bounded `.patch` files, applied by contained Bun preparation.
Member-local patches, overrides and catalogs
are not supported by that preparation profile. Registry
dependencies use existing bounded, script-disabled Bun preparation. Review
does not traverse live installation links. Missing locks require the existing
explicit resolution-network permission; Run never installs or resolves.
The resulting package source, contract and execution closure are retained
together. Selecting an implementation does not grant its required resources.
Dependency Flow selection is recaptured and prepared at each review, including
the existing resolution permission for a missing lock.

The wire target remains an ordinary Flow; its retained logical package address
is the `npm:` selector. A dependency may require settings and grants through
a local Binding just like a directory-based Flow.

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
used by this Binding's package as a Run/0 `flow/call` slot. Each value is an
exact `flow:<project-relative-path>`, `npm:<package-name>` or `binding:<LocalName>` selector,
an inline resource grant, or a `grant:<LocalName>` selection. Grant names
are slot selections, not CLI Run targets. A Flow selector requires a direct
Flow target; a Binding selector uses that Binding's own validated settings.
Either child may invoke an ordinary Agent Flow; a configured Binding may
also use explicitly granted Project Command, HTTP or Finite ACP slots. A selected Flow or Binding
may have further Flow/Binding child routes within the fixed root resource budget; resource
slots do not count as child routes. Aggregate reservations may limit concurrency
for deeper branches; see [project policy](project-policy.md). A Binding cannot select its own package, directly or
through another Flow or Binding. Omitting `slots` normalizes the declaration to
`{}`; review then fills matching named requirements from project defaults.
The example's `critic` Binding selects a separate package such as
`flows/critique`, with its own settings and no slots.

Slots are exact project links, not requests for later resolution. Project
review binds each slot to the named Flow or Binding target in the same candidate,
and admission retains that complete relation in one immutable generation.
Explicit Binding routes belong only to that Binding: running the package through
its `flow:` identity never borrows them. Project defaults and qualified native
implementations are resolved independently from each target's own requirements.
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
supported contract for its resource kind. HTTP, Project Command, and Finite ACP
use the ordinary Binding slot limit of eight total; selecting a resource does
not increase execution capacity.
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
settings, fits the root attachment profile, and has all requirements resolved
by reviewed ordinary defaults or qualified root Run Checkpoint support is also an
exact direct Flow target. A package without requirements needs no defaults.
The complete direct-Flow and Binding graph must be acyclic and each branch must
fit the fixed root resource budget (currently at most five child levels with
one effect allowance). Concurrent branches also share that budget. There is no
hidden generated Binding.

A required named invocation is declared by `uses.<slot>.contract` in package
metadata. The selected Flow must offer exactly that ID, version and digest
through its root `FLOW.contract.json`; anonymous ordinary calls need no contract.
Only qualified [Run Checkpoint](run-checkpoint.md) slots resolve implicitly to
host support. HTTP Request, Finite ACP and Project Command require explicit
slot grants. Those three contracts and Run Checkpoint cannot be
implemented by mapping a package that merely claims their host-only identity.
Review shows expected contracts and selected routes together. See
[project policy](project-policy.md#5-bindings) for qualification and limits.

## Value rules

All helpers are synchronous and side-effect-free. They return deeply frozen
plain data and reject:

- unknown keys;
- explicit `undefined` or `null` for optional object fields;
- functions, accessors, symbols, bigint, non-finite numbers, sparse arrays,
  cycles, class instances, and other non-JSON/0 values;
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
semantic choice, Hooks, Services, Journal publishers, provider credentials,
arbitrary permission grants, runtime selection, sandbox selection, attachment
projection, or administration. Exact project `defaultProviders` and Binding `slots`
select ordinary implementations; they do not introduce a runtime registry or
widen the selected implementation's authority.

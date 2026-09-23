# Managed contract authoring

Jig's optional authoring operation serves editable, portable methods without
adding a compiler requirement to FLOW. Native invocation meaning remains owned
by [Invocation Contract/0](https://flow.jig.md/spec/invocation-contracts).

`jig review --generate-contracts` grants per-command permission to use the installed
fixed TypeSpec translator and publish its generated files before review. It
does not admit execution or authorize dependency networking. Plain review and
Run MUST NOT compile. Previously admitted generations remain immutable.

Only selected Flow members participate. Compilation consumes captured root
`FLOW.contract.tsp`, with the bounded `flow-authoring-typespec/0` profile; no
package executable, module extension, remote import or ambient configuration
is evaluated. The operator's absolute `JIG_AUTHORING_NODE_PATH`, or a Node 22+
binary at `/usr/bin/node`, `/usr/local/bin/node`, or
`/run/current-system/sw/bin/node`, supplies the authoring runtime. Source cannot
select that executable. Compiler runtime files ship as bundled dependencies;
no authoring-time installation occurs.

The compiler receives no operator environment. A 20-second process ceiling,
stdin lifetime lease, parent cancellation and bounded output complement the
authoring package's 10-second worker, 128 MiB old-generation heap, 64 KiB source
and 1 MiB artifact-packet limits. The parent waits for process termination;
no result is accepted after cancellation or incomplete execution. These are
trusted compiler bounds, not containment for arbitrary code or total RSS.
At most 32 compilations are attempted per project plan.

The explicit operation stamps the current toolchain identity and preserves the
header's boolean `types` selection (default true for new source). Unsupported
profiles fail. A tool upgrade is selected by the next explicit generation,
not by opening or running an existing package.

## Optional feature catalogs

The single-form `@invocation(Input, Result, options)` supports `options.features`
only with an exact `id`/`version` pair. Its value is the native invocation
descriptor's optional `features` map: at most 256 distinct `LocalName` keys,
each at most 64 characters, with descriptions of 1–16,384 Unicode scalars.
An empty map is preserved and still requires identity; omission remains absent.
The ordinary descriptor and artifact limits apply. Invalid names, values,
bounds or identity fail the complete artifact batch.

Generation preserves this catalog in `FLOW.contract.json`, where it participates
in the ordinary exact invocation digest. It does not change input/result
schemas or generated TypeScript types. Package `supports` and dependency
`requires` remain separately authored metadata. Compilation supplies no
implementation support, grant, settings predicate, feature inheritance, named
operation, or runtime query. The native contract reader validates the completed
catalog before managed publication.

## Publication and recovery

Channel ports may reference existing package-local JSON agreements instead of
generating them. Generation supplies captured available paths to the compiler,
then validates the complete descriptor and exact referenced bytes with the
native readers before publication. No URL or remote import is resolved.
The available-path inventory is bounded to 4096 names and 128 KiB; only exact
referenced agreements become recorded inputs. Native contract closure limits
still apply. Unrelated files are not interpreted as channel agreements.
Borrowed agreements remain user-owned: they are neither outputs nor candidates
for deletion. Their hashes participate in local freshness; changed bytes require
explicit regeneration and subsequent review. Publication and interrupted-batch
recovery check borrowed inputs before and after writing outputs. Changed inputs
block completion; recovery never replaces them. A managed output cannot silently
become borrowed, nor a recorded borrowed input become a generated output.

Each package has local management state outside Package/0 under `.jig`.
The project session provides one cooperating publisher. The complete descriptor
with its channel closure and requested Agent projections MUST pass the existing exact readers before
publication. Output names are fixed to `FLOW.contract.json`, optional
`FLOW.contract.d.ts`, bounded root `*.schema.json` projections and
`*.channel.json` agreements (at most 63 auxiliary outputs). Projection names
MUST NOT replace `input.schema.json`, `result.schema.json`, or
`settings.schema.json`. Missing or conflicting channel agreements fail the
complete batch before publication. The source
header is part of the same recorded batch.

Existing managed outputs must match their recorded bytes. Unowned destinations
may be adopted only if their bytes equal the proposed output. Unknown or edited
destinations fail instead of being overwritten. Only still-owned superseded
outputs can be removed. Source removal plus explicit generation relinquishes
all unchanged outputs to manual ownership and retains recovery source.

A durable pending record contains the before/after byte sets before replacement.
The preceding affected bytes are retained for recovery. Failed compilation
publishes no outputs. Cancellation or failure during publication leaves an
incomplete recorded batch; ordinary review refuses it. Explicit generation may
finish only that recorded batch, without recompiling it, when every file equals
its recorded before or after value. A third observed value is a conflict.
Records and individual files are bounded; recovery records are at most 4 MiB.

All output files are rechecked before recording completion. Review recaptures
the completed visible package and verifies it against local managed state before
admission. Source/header changes or output edits cannot silently inherit prior
freshness. Generic compilerless consumers validate native bytes without proving
their correspondence to the richer source.

File replacement is atomic individually, not collectively. Crash recovery and
observed-edit checks do not create filesystem compare-and-set or guarantee no
lost updates against unrestricted concurrent writers. There is no automatic
rollback over later edits, global watcher, general build system, or new Run API.

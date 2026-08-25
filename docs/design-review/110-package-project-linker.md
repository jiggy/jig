# Package-project semantic linker

**Status:** implemented private checkpoint, pending the complete captured
project and admission layers.

The first consumer of evaluated Binding declarations is now fixed. Jig links
exact retained Package/1 references, inert inspection facts, and injected
Binding values into one pure invocation-local semantic model.

```text
captured Flow member
    -> protected Package/1 artifact
    -> inert package inspection
                           \
evaluated Binding value ---+-> pure package-project linker
                                 -> invocation-local semantic model
```

This checkpoint deliberately is **not** the captured project aggregate from
review 108. Binding declaration closures and evaluator provenance do not exist
yet, so the result has no capture digest, durable aggregate identity, or claim
that it can be reconstructed after restart. It is also not an admission
candidate: it contains no runtime, Sandbox Backend, Agent, authority,
availability, lock, generation, or live provider decision.

## 1. Exact inputs

One retained Flow input carries:

- its configured project path and discovery/exact membership provenance;
- one private `PackageArtifactRef` naming canonical Package/1 bytes; and
- the inert inspection produced from those exact bytes.

The linker independently validates the closed Package reference and requires
the inspection digest to equal it. Several project paths may intentionally
name identical package bytes; path identity and content identity do not
collapse.

One injected Binding input carries its captured declaration path and unknown
default-export value. The linker derives the Binding ID from the exact
`<LocalName>.ts` basename and runs the value through `defineBinding()` again.
It does not trust TypeScript types or a helper-created brand. The declaration
path is retained for diagnostics, but it is not yet proof of declaration
membership or evaluator provenance.

The small preparation helper publishes captured Flow members to the protected
artifact store and returns retained inputs. The caller continues to own and
dispose the invocation-local source capture. Publication is content retention,
not admission.

Retained Flow inputs are opaque factory products registered by the retention
boundary. A matching digest string and fabricated inspection object are not an
accepted input. Durable recovery will need a corresponding reacquire, verify,
inspect, and register path before this model can survive restart.

## 2. Normalized meaning

The output is deeply immutable and contains a deliberately narrow semantic
projection rather than a second complete package-inspection model. The one
canonical invocation-local inspection stays in the linker's private prepared
state. The output contains:

- canonically ordered Flow paths and Binding IDs;
- exact project path plus exact Package/1 reference for every Flow and
  Binding;
- immutable mode, metadata, entrypoint, skills, exact contract identities, and
  narrow direct-Run eligibility;
- complete immutable Binding settings;
- every attachment joined to its package-declared access mode;
- one tagged slot map whose Flow-call members resolve to direct Flow or Run
  Binding identities and whose capability members resolve to one exact
  Service Binding export and Capability Contract identity.

Compiled schema functions and parsed contract maps remain private preparation
handles. They do not enter the linked value or become serializable aggregate
state. A later restart must reacquire the protected artifact and inspect it
again. Captured file handles likewise do not enter the linked value.

The linker does no I/O. Its package inputs can only come from the sibling
retention factory, which publishes the exact captured bytes first.

A candidate-wide one-million-unit semantic-work budget covers retained Flow
facts and the complete normalized Binding JSON trees. Per-value JSON/1 limits
therefore cannot multiply into unbounded aggregate linking work. The future
captured evaluator will add an earlier aggregate byte/work ceiling for parsing
and evaluation itself.

## 3. Closed package rules

Settings validate as one complete JSON/1 value against
`settings.schema.json`. Without that schema, only `{}` is legal. Jig does not
default, merge, coerce, strip, interpolate, or consult the environment.

Configured attachment keys must exactly equal the package declarations. The
output records mapping intent and access mode; it does not claim that the
source exists, has been safely captured, is leaseable, or will be granted.
Protected `.jig` state cannot be an attachment source.

Package `uses` keys are capability slots. Every one must be configured by one
`bindingRef()` to a Service Binding. A public use matches exactly one provider
export by contract URI, exact version, and canonical descriptor digest. Zero
matches are incompatible and several matches are ambiguous. `local: true`
cannot be fulfilled by the current package-only Binding union and therefore
fails explicitly rather than being guessed.

Every remaining configured slot is a `flow/call` slot. It accepts:

- one zero-configuration direct Run Flow;
- one Run package Binding; or
- a closed candidate set of those two identities.

Direct Flow eligibility is recomputed from inspection. A direct target must be
code-backed, require no capability or attachment mapping, and accept `{}`
settings. Recursive Run-call topology remains legal because it is runtime
control, not a provider-startup dependency. Required Service dependency cycles
are rejected because no member can become ready first.

Instruction-only Run packages currently reject when selected by a Binding.
Project Authoring SDK/1 has no Agent-provider field, and silently inventing one
would turn an incomplete declaration into ambient authority. Exact-code
packages with an instruction fallback remain exact-code packages at this
stage; fallback planning is later.

## 4. Security and ownership boundaries

This slice proves only semantic consistency of injected declarations and
retained package facts. In particular:

- a Package digest never substitutes for a project path;
- a Binding reference never substitutes for a direct Flow reference;
- matching package bytes at another path do not repair a dangling reference;
- settings and attachments cannot widen package declarations;
- capability compatibility is deterministic and precedes any semantic choice;
- direct and candidate targets remain explicit, closed identities; and
- no output grants filesystem, process, network, Agent, or provider authority.

The protected artifact store owns retained bytes. The invocation-local Flow
capture remains owned by its caller. The linker owns no resources and exposes
no public package export.

## 5. Deferred work

The next slice is the bounded TypeScript evaluator and declaration-capture
closure needed to turn injected values into evidence. It must add:

- exact `jig.ts` and Binding declaration bytes;
- one confined static import closure;
- evaluator, authoring SDK, and toolchain identities;
- bounded authority-free execution; and
- exact default-export validation and provenance.

Only after those facts exist may Jig assemble and identify the durable captured
project aggregate. Resolution and admission then consume that aggregate; they
must not be folded into the evaluator or this linker.

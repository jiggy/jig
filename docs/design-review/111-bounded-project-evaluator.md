# Bounded project evaluator

**Status:** implemented private one-module checkpoint. It publishes no
evaluator, Sandbox Backend, or administration API.

The package/Binding linker now has an inert semantic consumer. The next trust
boundary turns captured TypeScript declarations into the plain values that
consumer accepts. It is not a general TypeScript loader and it is not a claim
that JavaScript evaluation is deterministic.

## 1. Honest security claim

The first evaluator uses one fresh root activation of an exact JavaScript
runtime recipe inside the already proven private Linux cgroup-v2 and
Bubblewrap envelope. Bun is the first candidate, but remains unavailable as a
general Runtime Adapter and is not qualified for this narrower evaluator role
until its dedicated hostile gates pass. That envelope can prove
that package-controlled code cannot reach the visible project, undeclared or
unmounted host files, host environment, network, secrets, Jig Services,
cgroup controls, or another Run.
It also bounds aggregate memory, PIDs, CPU rate, wall time, diagnostics, and
output, and fences the complete process tree on every terminal path.

It cannot honestly prove that a JavaScript engine has no clock or randomness.
Bun, in particular, needs the exact entropy device during startup, and realms contain several
time-related intrinsics. The old wording that evaluation has no clock or
randomness is therefore removed. Evaluation may be nondeterministic; the exact
captured output is normalized, identified, reviewed, and never recomputed by
resolution or apply.

JavaScript realm hardening is defence in depth, not the security boundary.
`node:vm`, deleted globals, frozen intrinsics, and source scanning do not
replace the enforced process envelope.

## 2. First checkpoint: one captured module

The first checkpoint deliberately accepts one `.ts` module containing only:

- static ESM imports which the closed resolver maps to the exact
  evaluator-provided `@jigging/jig` module; and
- one default export whose contextual kind is supplied by the host:
  `project` for `jig.ts`, or `binding` for `<LocalName>.ts`.

Project-local imports, other bare imports, built-ins, URLs, loader hooks,
native addons, project `tsconfig`, JSX, and path or extension guessing reject.
Runtime-generated loading has no resolver and CommonJS `require` is a throwing
bootstrap argument. The design does not pretend a source blacklist can prove
that arbitrary JavaScript never constructs a loader expression; containment
and the closed resolver are the authority boundary. This is an explicit
checkpoint restriction, not the final v1 authoring promise. It proves capture,
compilation, containment, value transport, and normalization before adding the
separate static-closure resolver.

Capture does not parse source. The module is captured descriptor-relatively
below one opened project root.
Every segment is opened without following symlinks. The file must be regular,
singly linked, valid UTF-8, at most 1 MiB, and unchanged across its read. The
project root and file identity are checked again before publication. Project
paths share Package/1's stable limits: 64 segments, 1,024 UTF-8 bytes total,
and 255 UTF-8 bytes per segment.

The capture exposes facts and copy-on-read bytes only. It is factory-authentic,
invocation-local input to the evaluator; mutable caller arrays and live source
paths never enter evaluation.

This one-file capture intentionally does not retain a project-root generation
receipt and cannot be assembled into the later durable aggregate. The
static-closure slice must pin one opened root for the complete candidate and
capture shared files once. This checkpoint proves only the lower-level source
isolation and ownership mechanics.

## 3. Build and evaluation

The trusted bootstrap receives the captured source over its private stdin. It
uses a closed build resolver which serves only:

```text
captured entry bytes
exact evaluator-owned @jigging/jig JavaScript closure
```

There is no filesystem fallback or `node_modules` search. The evaluator's
actual parser and closed build resolver enforce language and import rules once;
capture does not carry a second approximate syntax scanner. The exact
authoring SDK is bundled and executed in the guest realm; the private
canonical normalizer runs again over decoded data in the host. The bootstrap
constructs its reduced `process` and text-codec values inside the guest realm
and injects no outer-worker object or callable. This closes the known
constructor path to the worker's stdout and exit controls. The VM remains
defence in depth, while the enforced process envelope remains the authority
boundary.

Before launch, Jig captures its complete built evaluator distribution into the
same immutable Package/1 backing used for retained packages. It materializes
only those captured bytes into an unpredictable read-only tree and mounts that
tree at `/jig-evaluator`. The tree is protected from package code but remains
owned by Jig's trusted host account; another process already holding that
account is outside this checkpoint's threat model. Within that boundary, the
receipt's aggregate package digest identifies the staged bytes and Jig never
reopens the original mutable distribution. The private checkpoint consumes one
trusted host-supplied sealed runtime observation containing the expected
executable digest and exact runtime-closure source set. It requires
the executable and each closure mount to be immutable Nix store paths mounted
onto themselves and rejects drift before launch. The hostile gate qualifies
only this evaluator tuple; the observation is not a reusable readiness profile,
public runtime identity, or future general Runtime Adapter API.

Evaluator resource limits are fixed by this implementation. Callers cannot
raise or lower them. The current ceiling is 256 MiB aggregate memory, 32
processes, 50% of one CPU, a three-second hard wall deadline, and a five-second
cleanup deadline.

The evaluator accepts exactly one default export. It copies that value into a
bounded JSON/1 tree inside the sandbox and emits one bootstrap-owned result.
No live object, function, Proxy, getter, compiled validator, or handle crosses
the process boundary. A Proxy may execute traps while the sandboxed copy is
attempted; the specification claims that no Proxy crosses, not that arbitrary
JavaScript reflection can identify every Proxy without invoking it.

The coordinator then:

1. decodes the one bounded result with FLOW JSON/1;
2. validates the contextual `project` or `packageBinding` schema branch;
3. independently runs the corresponding private canonical normalizer over
   fresh decoded data; and
4. retains only deeply frozen normalized data and provenance.

Private `normalizeJigDefinition()` and
`normalizePackageBindingDefinition()` functions are idempotent over canonical
outputs. The public `defineJig()` and `defineBinding()` author inputs remain
smaller and reject their normalized-only discriminator forms.

Malformed wire output is an evaluator protocol fault. Syntax/import failures,
missing or invalid defaults, schema failures, resource exhaustion, exceptions,
nonzero exit, cancellation, cgroup limit events, and cleanup failure reject the
complete candidate. There is no unsandboxed or interpreted fallback.

## 4. Provenance

One evaluation receipt identifies at least:

```text
entry project path and source digest
evaluator protocol and implementation
authoring SDK and Project Authoring Schema/1
selected evaluator runtime/build toolchain and fixed build options
selected private runtime observation
fixed Sandbox plan, pre-launch helper and enforcement-tool observations,
cgroup identity, and terminal receipt
canonical normalized output and its digest
```

These are private candidate facts, not fields authors maintain and not public
machine-schema properties. The current Project Authoring Schema/1 remains the
shape schema for one authored value.

## 5. Checkpoint evidence

The privileged Linux corpus now evaluates both project and Binding values from
captured bytes and proves that later source mutation does not alter the result.
It rejects project-local, synthetic-namespace, CommonJS, and dynamic imports;
syntax errors; extra exports; wrong contextual schemas; runtime-constructed
loading; and non-terminating evaluation. A hostile declaration also attempts
the known constructor paths from realm objects to the worker's `process` and
stdout; it cannot forge the result channel in the tested tuple. Every accepted
result records the sealed source, evaluator, SDK, schema, runtime, helper,
Bubblewrap, launcher, cgroup, limit, and terminal evidence described above.

This is a bounded checkpoint, not a claim that `node:vm` is a general security
boundary. If authored code escapes the reduced realm by another engine flaw,
the outer cgroup/Bubblewrap envelope and the host's schema and canonical
normalizer remain authoritative.

## 6. Following checkpoint

After the one-module evaluator passes hostile tests, the next slice adds a
closed project-local static import graph. It must use explicit `.ts` paths,
capture shared files once candidate-wide, reject cycles and escape/collision
hazards, build only from captured bytes, and include canonical module paths,
content digests, and resolved edges in the closure identity.

Only after that closure exists can Jig complete the two-stage project capture:

```text
capture and evaluate jig.ts
    -> expand and capture declared sources
    -> capture and evaluate Binding closures
    -> assemble one retained project aggregate
    -> link, resolve, review, and apply
```

Hooks, Semantic Choice, Agents, host capabilities, resolution, admission, and
live administration remain outside this evaluator.

# Jig Runtime Adapters/1

**Status:** reviewed Jig host semantics. Closed registration, planning,
receipt, and error models for Runtime Adapters and Sandbox Backends remain
release gates. Runtime Adapters are host extensions, not FLOW package metadata
or a FLOW conformance profile.

FLOW standardizes one obvious implementation file and the Run/1 process
boundary. Jig decides how source becomes that process. It does not standardize
Python, Deno, Bun, Node, shells, compilers, package managers, or their version
grammars.

The honest portability claim is deliberately conditional:

> A code-backed FLOW package can run on a host whose operator has explicitly
> installed and selected an Adapter capable of preparing that source under its
> native constraints.

FLOW does not promise identical behavior across different toolchains or
Adapters.

## 1. Package surface

A package has either:

- no root implementation, making it instruction-only; or
- exactly one regular root file named `flow.<suffix>`.

`suffix` is one lower-ASCII alphanumeric segment, 1–16 characters. There is no
extensionless `flow`, multi-suffix entrypoint, executable-bit meaning,
`runtime` frontmatter field, Runtime Profile, Runtime Interface, command,
arguments array, or runtime digest.

The suffix is an inert candidate filter. `.ts` does not itself select Deno,
Bun, Node, or `tsx`.

### Optional selector line

When the first bytes are `#!`, Jig MUST parse the complete first UTF-8 line as
this exact selector form:

```text
#!/usr/bin/env <adapter-token>
```

The complete grammar is:

```text
^#!/usr/bin/env [A-Za-z0-9][A-Za-z0-9._+-]{0,63}\r?$
```

The token is an opaque, host-local Adapter selector. Jig never:

- asks the operating system to execute the shebang;
- invokes `/usr/bin/env`;
- searches `PATH` because of it;
- accepts `-S`, flags, arguments, quoting, substitution, or a path; or
- installs or trusts an Adapter because the token appeared.

A valid token narrows selection to the exact trusted Adapter mapping configured
on this host. It is not a global runtime identity, version requirement,
dependency, or portable semantic contract. An unrecognized token leaves the
package discoverable but makes exact activation `RUNTIME_UNAVAILABLE`.

When the first bytes are not `#!`, the package has no selector. If they are
`#!` but the complete line does not match the grammar, portable Jig activation
rejects the package. A host cannot ignore, partially parse, or delegate this
line. This avoids two parties assigning different launcher semantics to the
same bytes.

## 2. Runtime Adapter

A Runtime Adapter is trusted, explicitly installed host machinery. It may be
distributed through Git, npm, OCI, a system package, or a local artifact, but a
FLOW package and a Starter cannot install, select, or grant trust to it.

An Adapter registers inert facts such as:

```text
adapter identity and implementation revision
recognized selector tokens
recognized root suffixes
native manifests and lock forms it understands
toolchains available under explicit host configuration
RuntimeAdapter/1 revision
```

Its bounded interface is conceptually:

```text
inspect(package snapshot, host toolchain evidence) -> eligibility evidence
planProbe(configured toolchain) -> optional closed probe plan
planPreparation(package snapshot, toolchain, policy) -> closed preparation plan
planLaunch(
  prepared snapshot,
  toolchain,
  owner plan: RunPlan | ServiceMountPlan,
) -> closed launch plan
```

An Adapter may parse native metadata and consume host-verified toolchain
evidence. When more evidence is required, it emits a closed probe plan for
host-controlled execution. It may not execute package-controlled code, spawn the implementation,
open a shell, fetch mutable dependencies itself, inherit ambient environment or
`PATH`, choose arbitrary host paths, widen authority, or return an unbounded
command template.

An out-of-process, read-only Adapter implementation is preferred. An in-process
Adapter is privileged host code; sandboxing the Flow does not make a compromised
in-process Adapter safe.

The Sandbox Backend launches and supervises an out-of-process Adapter worker
inside a fixed host-owned planning sandbox. Inspection and preparation planning
receive read-only access to the immutable package snapshot and verified
toolchain evidence. Only a `planLaunch` call additionally receives read-only
access to the sealed prepared snapshot and the closed, authority-normalized
`RunPlan` or `ServiceMountPlan`; it receives no attachment contents or secrets.
Every call has bounded resources and no network, ambient environment, effects,
or authority outside its fenced descendant process tree. This sandbox is
chosen by host policy rather than by any package-produced plan. An Adapter
parser exploit must therefore cross the Backend boundary; choosing an
in-process Adapter explicitly enlarges Jig's trusted computing base.

## 3. Deterministic selection

Adapter selection is a planning operation for one candidate admission
generation. It is never deferred to `flow/run` or repeated by a Run. For one
immutable package and host-policy snapshot, Jig:

1. enumerates explicitly installed Adapters which recognize the suffix;
2. applies the optional selector-token mapping;
3. asks candidates to inspect inert native manifests, locks, and verified
   toolchain evidence, executing any bounded probe only through host control;
4. removes candidates whose native constraints cannot be satisfied;
5. applies an explicit host preference when one exists; and
6. accepts exactly one candidate.

Zero eligible candidates is `RUNTIME_UNAVAILABLE`. More than one without an
explicit preference is `RUNTIME_AMBIGUOUS`. Installation order, filename order,
semantic reasoning, source-code guessing, ambient `PATH`, and previous success
never break a tie.

When exact-code selection yields zero candidates, project policy may select a
separately qualified, explicitly permitted instruction recipe instead;
otherwise the structurally valid Binding may be admitted unavailable. Several
candidates is `RUNTIME_AMBIGUOUS` and never activates instruction fallback. An
unavailable Binding does not prevent unrelated ready Bindings from being
admitted, but it is excluded from Resolver candidate sets and cannot spawn or
mount. Structural package, settings, schema, contract, reference, or authority
errors still invalidate the aggregate candidate.

Without a selector line, different hosts may intentionally select different
Adapters for genuinely cross-runtime source. That choice is visible local
activation state, not an invisible claim that all choices are equivalent.

## 4. Runtime versions and dependencies

Runtime and package dependency constraints remain in native ecosystem metadata
when such a seam exists. For example, Python 3.13 or newer belongs in
`pyproject.toml`:

```toml
[project]
requires-python = ">=3.13,<4"
```

The Python Adapter treats that constraint as an eligibility condition. Node,
Deno, Bun, and other Adapters similarly define which native files they honor.
FLOW does not duplicate those constraints or invent one polymorphic version
grammar.

If an ecosystem has no credible native constraint seam, its Adapter may define
a committed adapter-specific convention or a more specific selector token.
That convention is not promoted into FLOW merely because one Adapter needs it.

Native manifests and lockfiles remain ordinary package bytes. An Adapter
reports whether dependency preparation is locked, mutable, unavailable, or
requires extra authority. Project or host policy may require reproducible
preparation. FLOW/1 does not claim universal dependency locking across package
managers.

## 5. Preparation and launch authority

The Adapter plans. The Sandbox Backend alone executes every process which may
consume package-controlled bytes, including package managers, compilers,
archive tools, build steps, instruction conductors, and the final
implementation.

The boundary is:

```text
immutable package + Binding + host policy
    -> Adapter inspection and closed plans
    -> authority-plan validation
    -> Sandbox Backend seal
    -> Sandbox Backend spawn
    -> enforcement receipt
```

Preparation receives a separate, independently minimized authority envelope
from the final Run or Service Mount. It cannot see owner attachments, secrets,
project policy roots, or effect slots. Network access, if allowed for
preparation, is an explicit Backend-enforced preparation policy; it is neither
comparable with nor inherited by the component's final authority.

Every host-dispatched preparation activation is a distinct child owner using
the same fenced lifecycle as the final Run or Service Mount: durable spawn
intent, Backend seal/spawn, realized enforcement receipt, bounded ownership,
and cleanup or fencing. One such activation owns and fences its complete
descendant process tree; package-manager or compiler subprocesses are not new
Jig owners. Jig accepts its prepared snapshot only after that child quiesces
successfully and the snapshot passes safe-tree validation. The later final
activation has its own spawn intent, seal, receipt, and cleanup.

An exact-code activation may additionally expose one **Runtime Support
Closure** selected solely by its admitted Adapter/toolchain recipe. The closure
is a finite set of immutable read-only trees containing only the interpreter,
loader, libraries, standard-library data, and fixed support files needed to
start that implementation. It is host runtime machinery and part of the
observable execution environment and trust boundary; it is not Package/1
content, an attachment, capability, setting, Binding grant, or author-selected
requirement. A package or Starter cannot name, extend, replace, or obtain
ambient lookup into it.

Planning pins the closure artifact revision, content identity, executable, and
sandbox mount map. The Backend mounts exactly that sealed closure and records
the realized identity. The closure excludes mutable host paths, home or config
directories, credentials, package caches, project or `.jig` state, IPC
endpoints, and unrelated files. Dependencies prepared from package-native
metadata belong to the separately sealed prepared package tree. If the closure
cannot be enumerated, sealed, and mounted without broader host visibility, the
activation is unavailable.

An exact-code recipe may additionally need a kernel-generated process view or
a small runtime device set. These are Adapter-selected host mechanisms, not
Package/1 metadata, attachments, capabilities, settings, Binding grants, or
author-selectable requirements. They remain inside the exact Backend plan and
receipt; FLOW does not standardize their operating-system representation.

A process view must be generated inside the activation's PID and cgroup
namespaces, mounted read-only, and limited to that namespace's processes. It
must not bind the host's procfs, expose host or sibling process state, provide
writable sysctls, expose cgroup controls, or permit namespace creation or
migration. Per-process paths such as `self` must resolve for the calling
descendant rather than remain pinned to the activation root.

Runtime devices must be fresh Backend-owned resources with an exact least-mode
projection. A Backend must not reuse or chmod a host device node and must not
make unrelated devices visible. The plan and receipt identify the mechanism
and required projections; cleanup removes every temporary resource. If these
invariants cannot be proven, the recipe is unavailable. The private Linux
proof currently realizes a read-only namespace-local procfs plus fresh
`/dev/null` and read-only `/dev/urandom`; those names are implementation
evidence, not a public Backend vocabulary.

The Sandbox Backend treats every descendant as an implementation detail of the
same activation owner. Descendants receive no independent Run, Mount, Binding,
effect, protocol channel, or authority; the Backend keeps them within the same
or a narrower envelope, applies the owner's finite resource bounds to the
complete tree, and fences and reaps it before owner completion. A namespace or
other mechanism capable of weakening that envelope is denied. The standard
does not prescribe a syscall list or mistake language-runtime mediation for a
portable enforcement boundary.

Jig v1 has one package activation mode: the Backend enforces every required
predicate or activation fails. A package, Binding, Starter, or Semantic Choice
ranker cannot select or weaken the Backend. Host-native trusted capability
providers are a separate admission branch; they are never a bypass for running
package-controlled code without containment. A future explicitly nonportable
trusted-code mode would require its own reviewed specification and is not part
of v1.

## 6. Local evidence and failure

Activation records host-local evidence including:

```text
package and entrypoint digest
native manifest and lock digests
selected Adapter artifact/revision
actual toolchain path, version, and fingerprint
inspection result
preparation and launch-plan digests
prepared-tree digest and provenance
Sandbox Backend revision, plan, and realized receipt
activation branch and authority envelope
```

These hashes are internal consistency evidence. They never appear as author
requirements in `FLOW.md` and do not create a runtime namespace.

An Adapter or toolchain change requires a new local activation recipe. It does
not change the FLOW package identity. Runtime, preparation, launch, or protocol
failure never causes Jig to try another Adapter silently.

For a selected exact-code implementation, planning records and apply pins:

```text
READY(exact staged activation recipe)
```

When no exact recipe qualifies, Adapter planning instead supplies the exact
unavailable reason and supporting evidence to project-policy branch selection.

The recipe pins the selected Adapter artifact/revision, actual toolchain path
and fingerprint, closed preparation plan, launch-planner identity, Sandbox
Backend artifact/revision, Backend preparation and launch-envelope plans, and
final authority envelope. A concrete launch plan cannot exist yet:
`planLaunch` consumes the immutable prepared snapshot and the matching closed
owner plan.

A Run or Service Mount consumes only that pinned generation result. For
`READY`, its owner verifies the pinned machinery, executes every
required host-dispatched preparation activation through the pinned Backend
lifecycle, with each activation owning its complete descendant process tree,
obtains and records the immutable prepared snapshot, asks the pinned launch
planner for the concrete plan using the matching closed owner-plan variant,
validates that plan against the pinned recipe and authority envelope, and asks
the pinned Backend to seal and spawn it. It never probes again, changes Adapter
or Backend, or becomes ready because the host was repaired after admission.
Changed or missing pinned machinery fails visibly without substitution.
Host-machinery changes create a new candidate generation requiring ordinary
review and apply.

Root submission and idempotency behavior for a pinned `UNAVAILABLE` result are
owned by [project policy §2.2](project-policy.md#22-admission-and-operational-readiness)
and [§10](project-policy.md#10-root-run-admission).

Instruction fallback is a distinct implementation selected and pinned during
candidate planning. It is allowed only when exact planning yields zero complete
recipes and both the package and Binding opt in; ambiguity never falls back. It
is never selected by a Run or used as recovery after an exact recipe was
pinned. Branch selection details belong to project policy rather than the
Adapter interface.

## 7. Required conformance cases

1. Zero implementations is instruction-only; one `flow.<suffix>` is exact;
   multiple root candidates are invalid.
2. Unknown suffix or selector token is discoverable but unavailable.
3. Selector parsing agrees across platforms; paths, `env -S`, flags, and extra
   tokens reject.
4. Candidate order never selects an Adapter; zero/one/many produces
   unavailable/selected/ambiguous.
5. A selector-free `.ts` Flow can run under two explicit host policies while
   the selected Adapter remains visible in each activation.
6. `requires-python` rejects an incompatible interpreter before preparation.
7. Native manifest/lock conflicts make an Adapter ineligible without executing
   package code.
8. Adapter inspection and planning cannot spawn or widen authority.
9. Package-influenced preparation and launch occur only through the Sandbox
   Backend.
10. Adapter/toolchain replacement invalidates local activation evidence but
    not package identity.
11. Missing runtime support never silently invokes Markdown unless the exact
    pre-launch fallback policy allows it.
12. One unavailable Binding does not block admission or execution of an
    independent ready Binding; it is excluded from resolution candidates.
13. A Run and a Service Mount each use only their admission generation's pinned
    recipe, derive launch only after Backend-supervised pinned preparation, and
    never substitute machinery after loss or later host repair.
14. Exact planning with zero recipes may use an explicitly opted-in instruction
    recipe; ambiguity never does.
15. Launch planning for either owner kind sees the exact sealed prepared
    snapshot read-only and no attachment contents, secrets, effects, network,
    ambient environment, or authority outside the closed launch description.
16. Every host-dispatched preparation activation and final Run/Service
    activation has a distinct spawn intent, Backend seal/receipt, bounded owner,
    and cleanup/fencing result; each owner covers its complete descendant
    process tree.
17. A Runtime Support Closure is finite, immutable, read-only, pinned and
    receipted; exposing a broad host root, mutable lookup path, cache, home,
    credential, or unrelated runtime tree is not a conforming substitute.
18. Descendant creation never widens authority or creates an implicit owner;
    the complete tree shares finite resource bounds, quiescence, fencing, and
    cleanup.
19. Adapter-selected process views and runtime devices are exact Backend
    mechanisms, not package authority: process views are namespace-local and
    read-only, per-process paths retarget correctly for descendants, devices
    are fresh least-mode projections, and all such resources are fenced and
    removed with the owner.

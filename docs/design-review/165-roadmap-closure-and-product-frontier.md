# Roadmap closure and first product frontier

**Status:** historical roadmap disposition, superseded for current ordering by
review 198. Reviewed on 2026-08-28. Every vertical in the approved exploratory
roadmap now has a recorded disposition: a bounded proof, an explicit blocker,
an open gated seam, or a deliberate negative result. This does **not** mean
that Jig is an operable alpha or that every product/interface question is
resolved. It turns the undifferentiated research backlog into explicit gates
and selects the next bounded product seam.

## 1. Where the system actually stands

The repository now contains three different maturity levels which must not be
collapsed into one claim:

```text
portable FLOW foundations
    Run/1, Package/1, Schema/1, Run SDK/1 and Service/1 candidates

private Jig execution evidence
    protected project state, exact admission, contained Runs, composition,
    Journal, Hooks, one Service generation, recovery and atomic publication

public Jig product
    not yet present
```

The private evidence is substantial. It proves that the architecture can be
implemented without ambient runtimes, hidden redispatch, graph mirroring,
package-manager ownership, writable cgroup access, or a privileged Flow path.
It does not provide the trusted project-opening, authority-issuance,
installation, or public operation boundary required by an outside operator.

The current honest verdict is therefore:

> The exploratory architecture is closed well enough to begin productization.
> The product itself is not closed.

## 2. Disposition of the approved verticals

| Vertical | Earned result | What remains outside the claim |
|---|---|---|
| FLOW foundations | Run/1 and its TypeScript/Python SDK surfaces, Package/1 and Schema/1 are frozen prerelease candidates with two-peer and independent-author evidence. | Publication, licensing, version metadata and a general certification programme. |
| Secure root execution | Exact Bun and Python root Runs pass the private cgroup-v2/Bubblewrap envelope, durable ownership, deadline, fencing and zero-residue corpus. | A production administrator-owned launcher/runtime-support installation on a fresh host; a second mechanism before any public Backend or Adapter SPI. |
| Foreground dogfood and Plan/2 | One finite private `plan` -> explicit `apply` -> `run` session works over retained reviewed bytes. Classification/apply and final Candidate/Plan publication are proved. | Trusted project acquisition, the remaining authority/inspection matrix and a closed public operation/error model. |
| Deterministic child Flow | One exact pinned child call has durable join, replay, conflict, cancellation, deadline and coordinator-loss behavior. | A generic scheduler, live catalogue lookup or recursive Flow composition. |
| Canonical Journal effect | One exact host-owned `append` has durable replay/conflict, closure, recovery and authority validation. | A generic effect registry or public Journal inspection API. |
| Admitted Hooks | One admitted Hook interval can be selected atomically with an Event, allocate exact derived Runs, recover lost wakes and conservatively fence coordinator loss. | Stable public Hook authoring/inspection, arbitrary producers, filters, callbacks, replay or subscriptions. |
| Service generation and Service effect | The Service/1 wire and Provider SDK candidates, one contained acknowledged Bun generation, pinned leases, a real Root-to-Service call, normal closure and one manual post-dispatch coordinator-loss choreography pass. | Authentic pre-dispatch loss, the remaining mixed cancellation/deadline races, automatic supervision, a second Host and the complete portable Host conformance corpus. |
| Agent Run | Canonical Agent Run values and exact per-call, read-only Flow-local skill projection pass as a pure private operation. | An operator-installed provider artifact and an earned registration/lifetime boundary, contained execution, durable effect ownership and a public provider ABI. Progress requires that external artifact; its absence is not permission to use a mutable fixture or publish a speculative registration model. |
| Semantic Choice | A deterministic injected chooser can select or abstain over a canonical closed allowlist; malformed or unknown choices fail. | Durable decision ownership, provider integration, survivor evidence and uncertainty handling. |
| Changing candidate universe | Two frozen-interface consumers selected the explicit `projectRunTargets()` marker and its generation-pinned expansion semantics. | Authoring, lock, Plan-delta, filtering and runtime implementation. The experiment selected meaning; it did not ship a resolver. |
| Jig Graph over Sley | A private lowering experiment worked and was removed after failing its value-over-direct-Sley gate. | No Jig Graph API exists. Work resumes only when a real stored graph needs independent validation and includes meaningful non-router behavior. |
| Atomic Plan publication | One opaque both-head base and factory Candidate publish the Candidate observation and applicable Plan together in one failure-atomic protected transaction, or leave Candidate rows/head, Plan rows and admission state unchanged. | This is not an atomic filesystem snapshot; pre-publication content blobs may remain without authority; acknowledgement replay and maximum-size Plan fault injection remain unproved. |
| Packed tooling | The private `@jigging/jig` tarball has an exact allowlist, excludes all host/runtime internals and passes installed CLI, Bun, schema and TypeScript consumer checks. | It cannot open a project, issue authority, operate the host or justify an alpha label. |

Review 154 remains intentionally **partially** closed. Review 162 proves one
post-dispatch loss choreography; it does not prove the pre-dispatch half of the
loss matrix or every mixed cancellation/deadline race. Likewise, review 163's
atomicity begins at the final protected transaction, not at arbitrary
multi-file source reads.

## 3. Architectural assessment after implementation pressure

### Minimalism

The strongest results are the things which did not become abstractions:

- the proof host's Nix store did not become Jig runtime management;
- one Linux enforcement mechanism did not become a public Sandbox Backend
  interface;
- one runtime planner did not become a public Runtime Adapter registry;
- the Agent fixture did not become a provider ABI;
- the Service proof did not become a supervisor;
- the dynamic-candidate experiment did not add named query/view algebra; and
- the Sley experiment did not leave behind a speculative Jig Graph DSL.

These removals are architectural progress. They keep FLOW concerned with
portable package and invocation meaning, Jig concerned with durable host
policy and ownership, and component runtimes such as Sley concerned with
their own live execution.

### Scalability

The current design scales semantically because every expensive or ambiguous
choice is converted into retained finite state before execution:

```text
editable source
    -> immutable Candidate
    -> reviewable Plan
    -> admitted generation
    -> exact owner operation
```

Operation IDs, pinned generations, bounded candidate sets, child-first
ownership and no-redispatch recovery prevent growth from changing meaning.
The current SQLite/local-coordinator implementation is deliberately a private
local implementation and proof substrate. It proves correctness, not
distributed throughput, global fairness or multi-host recovery. Those features
should not enter the first release without measured demand.

### Portability

FLOW's portable surface is language-neutral and has real TypeScript/Python
peers. Runtime selection, process closure and containment remain host policy,
which is the right boundary. The first Jig host may support a deliberately
narrow operating envelope without narrowing FLOW itself.

Portability must not be claimed from the private proof host. An external host
needs its own administrator-installed trust root. A second containment
mechanism may later reveal a public Backend abstraction; designing one now
would only encode Bubblewrap and cgroup v2 in generic names.

### Future-proofing

Versioned machine values, domain-separated identities, immutable admission
and explicit uncertainty make later extension possible without silently
reinterpreting old work. The principal future risk is not missing features;
it is prematurely publishing private types which encode the current SQLite,
coordinator or proof-host construction. Only independently consumed values
and operations should cross that line.

## 4. First product frontier

The next vertical should be one **trusted finite project-administration
session**. It is the shortest path from existing evidence to a usable local
Jig and exercises the architecture without introducing a daemon.

```text
acquire one local project through a descriptor-held trusted object
    -> plan without granting authority
    -> return one closed public result/error value
    -> apply only the explicitly retained Plan digest
    -> retain session-scoped Root Administration
    -> start only an exact admitted root and inspect its finite status
    -> close the project session
```

The implementation should wrap the existing failure-atomic private pipeline.
The public caller must not supply or observe state-store paths, runtime
recipes, coordinator epochs, cgroups, Bubblewrap arguments, helper paths or
host launch commands.

`plan` is not a read-only operation. It may read the project, bootstrap
protected Jig state and retain immutable packages, Candidate observations and
review Plans.
Its promise is narrower and useful: it mutates neither user source nor the
visible lock, grants no admission authority, and cannot execute package code
outside the already bounded evaluator. A post-commit response loss must be
proved to converge on the same Plan digest through the same project owner
before this operation is published; an idempotency token is added only if
content-idempotent rediscovery cannot provide that result.

The slice excludes:

- a daemon, socket protocol, watcher, list/watch/cancel API or background
  supervisor;
- public Service, Hook, Agent or Semantic-Choice administration, execution or
  conformance promises (the planner still inspects their admitted facts);
- public Runtime Adapter, Sandbox Backend or provider registration;
- updates, rollback, `jig init` and Starters; and
- distributed execution or durable arbitrary graph continuation.

Its proof gates are:

1. descriptor-confined project acquisition resists path substitution and
   retains one exact project identity for the complete session; a second
   acquisition either deliberately shares that authenticated owner or fails
   with bounded `PROJECT_BUSY`, never creating competing coordinator epochs or
   authority issuers;
2. `plan` is authority-neutral: it may retain packages and Candidate/Plan
   records, but it mutates neither user source nor lock/admission authority and
   has one closed public result/error union;
3. `apply(planDigest)` reopens the retained Plan, detects staleness and never
   re-evaluates visible source;
4. Root Administration remains trusted-host-only, `startRun` authorizes only
   exact admitted targets, and the object cannot be reconstructed from
   portable values;
5. the existing exact Bun/Python root path runs through that authority with
   unchanged containment and cleanup semantics; killing the project-session
   process after accepted dispatch and reopening through trusted acquisition
   preserves the existing coordinator-loss and fencing result;
6. object close and in-flight calls have one linearized result; close revokes
   every issued Root Administration object, prevents new starts, fences or
   settles live roots, awaits owned evaluator/process cleanup and then releases
   the project owner without erasing durable Run state;
7. a lost Plan response can be rediscovered without admission change or an
   ambiguous maybe-committed outcome; and
8. acquisition, `plan` and `apply` expose closed sanitized result/error unions
   which do not leak raw paths, `errno`, SQLite, helper or host details; and
9. an independent packed consumer uses only the proposed public subset.

These wrapper gates do not replace the still-open classifier/authority,
Plan-size/fault, schema and replay matrices recorded in reviews 150, 152 and
163. They must either be closed for the public subset or retained as explicit
release blockers; this list is not an exhaustive product conformance corpus.

Freeze alpha-versioned request/result schemas and CLI spelling only after that
consumer passes. Do not promise a 1.0 project-policy schema before the selected
changing-universe work has exercised its Candidate, lock and Plan impact. If a
private method is needed solely to make the consumer convenient, it does not
enter the interface.

## 5. Work which can proceed in parallel

The product frontier and host-installation frontier have independent owners
and can advance concurrently.

### Administrator-owned host installation

Define and prove one production installation contract on a fresh supported
Linux host:

```text
protected launcher/helper and policy
    + retained exact Bun/Python support
    + bounded read-only receipts
    + restart reacquisition and drift refusal
```

The administrator owns installation and lifetime; Jig authenticates the
evidence; FLOW receives none of the authority. If this cannot be proved
without managing the host package manager, stop with exact `UNAVAILABLE`.
Do not publish an extension SPI from this one mechanism.

### Release mechanics

The FLOW SDKs may advance toward a separately labelled draft/preview once
license, repository, version and release metadata are chosen and their
current cross-language package gates pass. Their package roots expose only
Run SDK/1; the separately gated Service/1 candidates live under explicit
service subpaths and do not acquire a conformance label by sharing a
distribution. A Run release does not wait for Service conformance and does not
imply a Jig host release.

For the first Jig tooling/host preview, the selected host posture is Linux and
Bun-only. The CLI already declares Bun; private Bun FLOW/evaluator execution
and Bun CLI compatibility are proved. Exact admitted Python and Bun
implementations may still run as FLOW packages; Node, Deno and Windows are
simply unclaimed Jig-host environments.
FLOW packages remain free to use any admitted runtime. Node support should be
added only when a real consumer justifies owning a bounded Unicode 15.1 NFC
implementation; Package/1 must not be weakened to the host's newer Unicode
database. Until the release metadata is actually selected, `@jigging/jig`
remains private `0.0.0` and the optional Node experiment remains a compatibility
observation, not a release gate.

## 6. Roadmap after the product frontier

The dependency structure is smaller than a single feature sequence:

```text
finite project administration (A) ----+--> external deterministic alpha
                                      |
production trust root (B) ------------+

A --> pure changing Run universe
B --> real Agent provider --------------------+
pure changing Run universe -------------------+--> durable Semantic Choice
B --> one Event Source --> featureful software-factory Starter
A --> jig init --bare

Service conformance -------------------------- demand-gated independent track
Jig Graph ------------------------------------ demand-gated independent track
```

Within that graph, use this default product priority:

1. **Finite project administration (A).** Close the first usable local
   operation and its independent packed consumer.
2. **Production trust root (B).** Proceed in parallel where an administrator
   can provide the environment. A and B are both required for an operational
   external alpha.
3. **External deterministic alpha.** Select license/version/metadata, run the
   Bun Jig package/host gate and every separately claimed FLOW SDK or
   Flow-runtime gate on a fresh host, and publish only the finite
   plan/apply/start/status surface actually proved.
4. **Pure changing Run universe.** After A, implement `projectRunTargets()` in
   authoring, lock, Plan and filtering over admitted generations without an
   Agent. This can proceed while provider work is blocked.
5. **Real Agent provider.** After B and operator-owned provider registration,
   prove contained one-shot execution, per-call skill projection, durable
   possible-dispatch/no-redispatch and zero residue before exposing an Agent
   effect.
6. **Durable Semantic Choice.** After both the pure universe and an admitted
   provider, add durable zero/one/many resolution and decision ownership. The
   chooser remains powerless over eligibility and authority, and an uncertain
   possibly dispatched choice is never reranked.
7. **One Event Source path.** After B and before claiming a software-factory
   Starter, prove one foreground watcher or timer whose host-owned publisher
   identity appends canonical facts, drives the already admitted Hook path,
   and fences cleanly. It need not create a daemon, universal Event-source API
   or public Service dependency.
8. **Initialization.** After A makes the finite project shape real, add
   `jig init --bare`. A featureful copied, user-owned software-factory Starter
   waits for the Agent, dynamic-universe and Event surfaces it actually uses.
   There is no questionnaire algebra or ongoing Starter dependency.
9. **Service profile, when a product needs it.** On its independent track,
   finish pre-dispatch loss, mixed cancellation/deadline cases, the complete
   Host-under-test corpus and a second independent Host before claiming
   portable Service conformance or exposing Service administration.
10. **Updates.** Implement deterministic `BASE + LOCAL + UPSTREAM` staging,
    three-way merge, validation, atomic publication and rollback first.
    Optional Agent repair is a later maintenance Flow; conflict without it
    remains staged and explicit. Visible project files stay authoritative,
    with no runtime patch overlay.
11. **Jig Graph, only on earned demand.** Keep direct Sley code inside FLOW
    packages until a real stored graph requires a detached Jig-owned model.

Do not move a later feature earlier merely because its private building block
already exists. In particular, Hooks, Services and Semantic Choice are not
prerequisites for the finite product frontier.

## 7. Closure validation

The final release-posture change separated the Service candidate from both Run
SDK package roots and removed Node from the Jig package gate without weakening
Package/1. The changed seams passed:

```text
TypeScript FLOW SDK                         53 tests, 117 assertions
Python FLOW SDK                             41 tests
TypeScript/Python Service Provider matrix
plus private process integration            35 tests, 131,307 assertions
TypeScript and Jig packed-artifact smokes   passed
Python wheel, sdist and clean installs      passed
```

After the complete Linux capability preflight, both hostile Service fixtures
affected by the subpath change passed: the clean Mount path and the manual
mixed coordinator-loss recovery path, the latter with 45 assertions. An
independent post-run scan found zero Jig Run cgroups, zero private-device
directories, and `/dev/urandom` remained character device `1:9`, mode `0666`.

The complete unprivileged aggregate was given a bounded four-minute run and
stopped without failure output in its known expensive lifetime/store corpus.
It is not counted as a pass. The unchanged areas had already passed their
causal shards during the individual verticals; this closure relies only on the
completed focused and shard evidence, not on an interrupted aggregate.

## 8. Release labels and stop rules

Use the following claims literally:

```text
foundation candidate
    portable protocol/SDK behavior is frozen prerelease and independently tested

private proof
    repository code proves one bounded mechanism on the proof host

tooling preview
    an installed package exposes only the named inert tooling surface

operational alpha
    a fresh supported host can install, open, plan, apply, run and inspect
    through documented public boundaries
```

No lower label implies a higher one.

Stop a vertical rather than widening it when it would require:

- package-manager lifecycle ownership;
- ambient executable or mutable provider discovery;
- a weaker containment or cleanup contract;
- replay of possibly dispatched work;
- a public abstraction inferred from one mechanism;
- a daemon solely to make a finite operation possible;
- a graph or query language created for its own probe; or
- a new public SDK member which no independent consumer required.

The next implementation cycle should repeat the successful discipline:

```text
freeze one finite boundary
    -> prove it privately
    -> test authority, crash and cleanup failures
    -> document exact claims and non-claims
    -> expose only the subset used by an independent packed consumer
```

That is the shortest route from a mature architecture to a small, honest
first product.

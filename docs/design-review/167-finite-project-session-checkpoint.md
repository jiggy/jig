# Finite trusted project-session checkpoint

**Status:** closed private implementation checkpoint on 2026-08-28. The
Project Administration/1 values, object-capability shape, machine schema, and
injected-session consumer are frozen as private prerelease candidates. Jig
still publishes no project opener, authentication or transport, production
host installation contract, or operational alpha.

Review 166 selected this boundary. This review records the implementation and
supersedes its provisional result fields and incomplete proof status.

## 1. Closed vertical

One private trusted host can now perform the finite sequence:

```text
descriptor-confined project acquisition
    -> one exclusive coordinator and exact device/inode identity
    -> authority-neutral plan in the bounded evaluator
    -> complete display-safe review paired with a retained Plan digest
    -> explicit digest-only apply
    -> unchanged session-owned Root Administration
    -> exact admitted root execution and finite status
    -> cancellation or coordinator-loss recovery
    -> revocation, fencing, cleanup, and owner release
```

The session reuses the existing Candidate/Plan store, root controller, exact
Bun/Python recipes, and private Linux Backend. It creates no daemon, second
scheduler, public Backend or Adapter SPI, generic provider system, or FLOW
administration capability.

## 2. Ownership and failure semantics

Acquisition holds one project-root descriptor and device/inode identity for
the complete lifetime, then acquires the one project coordinator. A second
owner gets the bounded `PROJECT_BUSY` result. Path replacement or coordinator
identity loss revokes the complete session; it never reattaches an existing
authority to replacement source.

Every project call takes a synchronous operation lease. Close changes the
state to closing, aborts planning, revokes every escaped Root Administration
reference, waits for accepted plan/apply calls, fences or settles root work,
and releases the project owner last. It returns the same Promise on replay.
An accepted apply preserves its exact result or error. Planning may terminate
as `PROJECT_CLOSED`. Cleanup or fence uncertainty is `UNAVAILABLE`; even a
rejected close leaves all issued authority irrevocably closed.

Wrapper loss after durable possible dispatch never causes redispatch. A later
owner first reacquires the complete fence and may then publish
`COORDINATOR_LOST`. Process disappearance alone is not success evidence.

## 3. Review and apply corrections

Adversarial review rejected the first candidate until five ambiguities were
removed:

- `ProjectAdministrationError` now rejects malformed Unicode, so every error
  projection remains FLOW JSON/1;
- approval receives one applicable subject containing operation, exact Plan
  digest, and review evidence, and the same digest is passed to apply;
- the sample consumer preserves operation and close failures independently,
  including `throw undefined` and ordered dual-failure aggregation;
- `lockMode` now has exact update-versus-locked planning and apply semantics;
  and
- the unused `receiptDigest` was removed because it named two unrelated
  private records and had no public consumer or dereference operation.

The review renderer no longer constructs an unbounded `JSON.stringify`
result after publication. It incrementally emits deterministic ASCII-only
JSON evidence, escaping every project-controlled non-ASCII scalar and control
so bidi and zero-width characters cannot alter display. It stops at 4 MiB,
which conservatively preserves the outer FLOW JSON/1 string and value bounds.
Rendering occurs as a pre-commit gate inside Candidate/Plan publication; a
failure rolls back every Candidate row, head movement, and Plan row introduced
by that transaction. A matching immutable Candidate which predated the attempt
is intentionally unchanged.
The complete returned public result is then validated as JSON/1.

The text is a complete proposed-state snapshot, not a current-to-proposed
diff. A stronger deterministic delta presentation remains an operational
alpha gate but can evolve inside the opaque review text without changing this
value shape.

## 4. Exact public-candidate boundary

The packed `@jigging/jig/administration` entry point exports only inert Root
Administration and Project Administration values, errors, and TypeScript
object-capability types. The project receipt is exactly:

```ts
interface ProjectApplyReceipt {
  readonly operation: "admission" | "lock-repair";
  readonly planDigest: string;
}
```

The tarball contains no project opener, private controller, evaluator,
runtime recipe, Backend, helper, host receipt, cgroup code, or launch command.
A clean external consumer receives an injected `ProjectSession`; it cannot
manufacture one or select host machinery.

Before the first admission, the eager `rootAdministration` object belongs to
the acquired project but `startRun` returns Root Administration `UNAVAILABLE`
without allocating a Run. Lock repair does not create a generation.

## 5. Evidence

The focused unprivileged contract, renderer, session-controller, and
CLI-boundary gate passes 16 tests and 80 assertions, with the one privileged
case deliberately skipped; the packed-package smoke also passes. The atomic
privileged publication witness passes 1 test and 100 assertions, proving that a
rejected display gate leaves zero Candidate and Plan authority before a later
successful revision 1 publication. A separate exact evaluator-envelope
regression passes 1 test and 18 assertions. The independent packed consumer typechecks,
builds, and runs using only `@jigging/jig/administration`, including the exact
approval/digest relation, minimal receipt, ordinary failure precedence,
`throw undefined`, and ordered dual-failure aggregation.

The final hostile project-session witness passes 3 tests and 50 assertions. It
covers exact direct Python and
composed Bun-to-Python execution, normal close cancellation, wrapper process
death and no-redispatch recovery, isolated proof-host evaluator cancellation,
strict
unknown-runtime unavailability, explicit Service-target refusal, and complete
cleanup. Independent inspection after the run finds zero Jig Run cgroups and
zero private-device directories; host `/dev/urandom` remains character device
`1:9`, mode `0666`.

## 6. Nonclaims and next gates

This checkpoint does not provide:

- a production administrator-owned launcher/runtime-support installation;
- a public acquisition function, daemon, authentication, transport, or remote
  object-capability encoding;
- list, watch, cancel, authority inspection, update, rollback, or `jig init`;
- public Agent, Hook, Service, Semantic Choice, Runtime Adapter, or Sandbox
  Backend administration;
- a structured public Plan, lock, or review-delta model; or
- a distributed scheduler or durable arbitrary graph continuation.

The next product boundary depends on both this finite session and a production
host trust root. A local external alpha may freeze acquisition/CLI spelling
only after those two pieces meet on a fresh supported host. Pure
`projectRunTargets()` expansion can proceed from the closed project model but
does not outrank the alpha trust-root gate.

# Private project Run-target evaluator profile

**Status:** closed on 2026-08-29 for sealed author evaluation only. The marker
is still rejected by the ordinary linker and has no lock, admission, Resolver,
or runtime meaning.

## 1. Why a separate profile is required

`projectRunTargets()` was previously only an in-process value checkpoint. A
project Binding is instead untrusted TypeScript evaluated inside Jig's bounded
author envelope. Making the helper visible through the public Project
Authoring SDK before its downstream meaning is closed would let the published
surface outrun its implementation.

The private evaluator therefore owns one additional exact profile:

```text
private-project-run-targets-authoring/1
```

It admits one evaluator-only sealed import:

```ts
import {
  defineBinding,
  projectRunTargets,
} from "@jigging/jig/private/project-run-targets";
```

The import is intercepted by the closed evaluator and resolved to a bundled,
digested SDK projection. It is absent from the packed package exports. The
profile exposes only `defineBinding` and `projectRunTargets`; the first is an
alias for the already-normalized private Binding helper rather than a second
Binding language.

## 2. Profile separation

Every evaluator request now names one of three closed profiles:

```text
project-authoring/1
private-project-authoring-hooks/1
private-project-run-targets-authoring/1
```

The request, selected Schema/1 bytes, worker, ordinary SDK, Hook SDK, private
Run-target SDK, runtime, and sandbox evidence are all committed by the
evaluation profile. The worker rejects a sealed import which is not admitted
by the request's exact profile.

The Run-target Binding schema accepts the existing package Binding and
Journal-publisher union, with the exact marker admitted only as a top-level
Flow-call slot source. It still rejects speculative marker fields and nesting
inside `candidates(...)`.

The retained private project pipeline evaluates Binding declarations under
this profile so it can retain the exact value and profile evidence. The
ordinary public author helper, public machine schema, ordinary evaluator
profile, Hook profile, packed exports, and `linkPackageProject()` continue to
reject or lack the marker.

## 3. Evidence

The focused pure suite, build, and packed-package smoke pass. A real
cgroup-v2/Bubblewrap evaluator proof establishes that:

- the private profile evaluates one Binding containing the exact marker;
- its profile contains the private SDK and schema digests;
- the ordinary Binding profile rejects the private sealed import;
- the Hook profile is unavailable inside the Run-target Binding profile; and
- an ordinary Journal publisher remains valid in the retained Binding union.

That proof passed with one test and six assertions, followed a successful
capability preflight, completed its full fence/cleanup path, and left no Jig
cgroup or private-device residue. The pre-existing evaluator regression and
the packed allowlist also pass.

## 4. Explicit stop boundary

This checkpoint does not:

- export `projectRunTargets()` publicly;
- expand the marker;
- change linked Flow-call records, the portable lock, activation requests,
  Candidate/Plan formats, or admission-store versions;
- select, filter, or invoke a target; or
- add Semantic Choice or another routing primitive.

The next checkpoint is a private two-phase linker which prepares the complete
project first and expands every marker from one immutable structural
catalogue. Until that linker is explicitly used by the retained aggregate,
the evaluator's accepted marker still fails closed downstream.

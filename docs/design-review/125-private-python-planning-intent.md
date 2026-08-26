# Private Python coordinator planning-intent boundary

**Status:** implemented and host-tested private compatibility correction. It
allows one separately evaluated coordinator bundle to plan the first exact
Python recipe without pretending that a `WeakSet` brand can cross an ESM
evaluation boundary. It creates no admission, persisted candidate, or public
Adapter interface. Planning does mint the existing coordinator-local,
non-admissible proof candidate; the intent does not authorize its production
execution.

## 1. The defect

The source planner accepted a factory-authenticated `PrivateActivationRequest`.
That was sound while request construction and planning shared one module
evaluation. It was unusable through the reviewed coordinator bundle:

```text
host package-resolution WeakSet
    !=
coordinator-bundle package-resolution WeakSet
```

A host-created request therefore could never satisfy the bundle-local guard.
Checking only the coordinator's export names or calling `observeRuntime` would
have missed this invalid interface.

## 2. Narrow inert port

The host-side projection still begins with
`requirePrivateActivationRequest()`. It accepts only the first exact recipe:

```text
direct Flow
target path == package path
mode run
flow.py / py with no selector
empty settings, attachments, and slots
```

It emits bounded canonical JSON/1 plus LF containing only:

```text
kind: python-exact-planning-intent/1
requestDigest
packagePath
Package/1 reference
```

Fixed mode, entrypoint, and empty collections are protocol constants rather
than caller-controlled duplicate fields.

The separately evaluated coordinator strictly decodes those bytes, rejects
alternate encodings and unknown fields, normalizes the project path and
Package/1 reference, reconstructs the one fixed activation-request value, and
recomputes `JIG-Activation-Request/1`. A mismatched digest rejects.

Decoded bytes prove exact reconstructable meaning, not linked-project
provenance or sender identity. They are never added to the activation-request
`WeakSet`. A caller which can already access the private coordinator namespace
and obtain its runtime and Backend brands can use hand-authored valid bytes to
mint a non-admissible proof candidate. Therefore the future trusted loader
must keep that namespace private, correlate request, target, package, and
candidate identities with its authentic retained request before execution,
and separately require protected admission.

## 3. One coordinator evaluation

The five-name coordinator surface remains:

```text
privateHostExtensionAbi
createBackend
execute
observeRuntime
plan
```

`plan` now consumes the planning-intent bytes. Runtime observations, Backend
instances, candidates, and execution stay branded inside one cached
coordinator evaluation:

```text
host authenticates request
    -> host encodes narrow intent
    -> exact coordinator observes runtime and Backend
    -> coordinator plans a fresh non-admissible candidate
    -> trusted loader compares request, package, target, and candidate identities
    -> protected admission authorizes production execution
    -> the same coordinator evaluation executes its own candidate and Backend
```

After restart, Jig must reacquire the retained project, rebuild the authentic
host request, load the exact rooted generation once, reobserve and replan, and
compare the fresh result with protected admission. There is no candidate
decoder: raw intent may only produce a fresh non-admissible proof candidate,
and the trusted loader must not call `execute` without the correlation and
admission gates above.

The intent kind is part of coordinator ABI compatibility. A host controlling
an older retained generation must use that generation's matching intent
projection rather than assuming newer bytes are compatible.

## 4. Evidence and non-claims

The ordinary corpus proves strict canonical decoding, exact request-digest
reconstruction, unknown-field and altered-meaning rejection, host-brand
rejection by the encoder, and that valid inert bytes proceed to the next live
runtime-brand gate.

The Linux host corpus additionally projects a real authentic retained request,
plans through the intent path, and obtains the same candidate identity as the
original process-local planner.

The [real-bundle checkpoint](126-private-host-bundle-proof.md) now calls the
separately bundled `plan`, rejects noncanonical intent, and proves that valid
intent bytes pass request decoding and local-runtime reverification before a
deliberately foreign Backend value is rejected. It also
executes the complete runtime/Backend/plan/execute brand chain in one bundled
coordinator evaluation. Root publication, authenticated loading, qualifying
active preflight, restart recovery, and `READY` remain separate gates.

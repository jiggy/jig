# Private project Run-target catalogue checkpoint

**Status:** private pure-value checkpoint closed on 2026-08-29. It derives
the complete structural Run universe but does not yet link or execute the
`projectRunTargets()` marker.

## 1. One authenticated source of truth

The catalogue accepts only a `PackageProjectValue` produced by the existing
private linker. A structurally identical object is rejected. It therefore
derives from the same retained, validated package and Binding facts which will
later feed lock and admission planning; it does not scan source, query a live
catalogue, or infer targets from filenames.

For one authenticated linked project it returns exactly:

- every Run Flow whose existing `directRun` decision is true; and
- every configured package Binding whose selected Flow is a Run package.

It excludes non-direct Run Flows, Service Flows and Bindings, Journal
publishers, and Hooks. A configured Run Binding remains present even when it
is the eventual dispatcher consuming the marker. Runtime readiness is not
consulted: a structurally valid target must remain visible so later planning
can record exact `UNAVAILABLE` rather than silently removing it.

## 2. Determinism and bounds

The result is a fresh frozen array of fresh frozen target identities, ordered
with the existing target order:

```text
Binding IDs first, then Flow paths; each branch in canonical project-path order
```

No changing-universe-specific cap is introduced. Existing bounded capture and
linking constrain the source project, and later activation planning retains
its independent aggregate target bound. Semantic Choice's 256-candidate call
limit is not a catalogue limit and must never cause truncation or sampling.

## 3. Evidence

Focused fixtures prove:

- direct Run Flow inclusion;
- configured and capability-consuming Run Binding inclusion;
- non-direct instruction/configured Flow exclusion;
- Service Flow/Binding exclusion;
- Journal publisher and Hook exclusion;
- stable order despite shuffled project declarations;
- fresh immutability on repeated derivation;
- the authenticated empty-project result; and
- forged-wrapper rejection.

The focused catalogue plus existing linker suite passes 19 tests and 67
assertions, and the Jig package builds.

## 4. Remaining integration gates

This checkpoint adds no public export and changes no portable value. The next
private slice must deliberately:

1. admit the marker through the sealed bounded author evaluator;
2. expand it once after all Flows and Bindings are linked;
3. retain slot source kind separately from the exact sorted expansion;
4. carry that meaning through the private lock, resolution identity, Candidate,
   Plan review, and admission path; and
5. prove the existing planning bound fails atomically rather than truncating.

Only then may deterministic runtime filtering consume the pinned expansion.
Child dispatch, a chooser, durable Semantic Choice, and public authoring remain
outside this pure checkpoint.

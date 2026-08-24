# Scenario: one policy, zero leaf Bindings

The current source tree contains:

```text
dynamic-defaults/
├── jig.ts
├── bindings/
│   └── dispatcher.ts
└── flows/
    ├── dispatcher/
    ├── echo-reverse/
    └── echo-upper/
```

`dispatcher.ts` is the only authored Binding. It maps local Run slot
`delegate` to `allRuns()`. The two leaf package directories have no Binding
files and qualify for the narrow derived default.

The tabletop starts with only `dispatcher/`, then stages `echo-upper/`, then
`echo-reverse/`, then removes `echo-upper/`. Every edit creates a candidate;
none changes the active generation until the user applies the matching
aggregate plan.

| Candidate | Source members | Proposed `delegate` snapshot | Call result after apply |
|---|---|---|---|
| G0 | dispatcher | empty | `BINDING_MISSING` |
| G1 | + echo-upper | `echo-upper` | selected directly; no ranker |
| G2 | + echo-reverse | `echo-reverse`, `echo-upper` | `BINDING_AMBIGUOUS`; no ranker configured |
| G3 | remove echo-upper | `echo-reverse` | selected directly; no ranker |

The snapshot order is unsigned UTF-8 order of Binding LocalNames, not add or
filesystem order. The expected fixture records each candidate's exact
Package/1 digest. The live G1 snapshot remains unchanged while G2 is only
planned; applying G2 changes the dispatcher and both derived defaults in one
generation compare-and-set.

The child result is deliberately checked in dispatcher code. Generic Flow
selection guarantees only the Run envelope, not that semantic similarity
creates a shared output contract.

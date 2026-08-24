# Dynamic defaults design probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This is coherent pseudocode against future packages. It is a falsification
> fixture, not a Starter, conformance corpus, or API commitment.

## Question under test

Can a project combine zero-boilerplate exact Runs with one deliberately open,
reviewed `flow/call` policy without turning discovery into live authority?

The expected answer has three parts:

1. `echo-upper` and `echo-reverse` derive ordinary least-authority Bindings;
2. `dispatcher` needs one explicit Binding because `allRuns()` is application
   policy, not a package default; and
3. every candidate-set change waits for aggregate plan/apply and pins exact
   candidate identities for that generation.

## Falsification rules

The design fails if:

- the dispatcher sees a newly discovered Run before aggregate apply;
- an unmapped slot behaves like `allRuns()`;
- default derivation or open selection runs a Semantic Choice provider;
- a two-candidate set is resolved by path, source, or insertion order;
- active ancestors remain eligible through an `allRuns()` edge;
- more than 256 survivors are silently truncated, sampled, or batched;
- transitive authority is computed by recursive expansion without a visited
  set, or omitted from review because children are mediated; or
- a derived Run bypasses the ordinary lock, admission, Adapter, Backend,
  revocation, or root-Run path.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Inspect `jig.ts`, the one Binding, and both defaultable leaf packages.
3. Compare the four tabletop generations in
   `expected/normalized-plan.json`.
4. Exercise lifecycle and failure walkthroughs.
5. Challenge every new surface through [`API-LEDGER.md`](API-LEDGER.md).

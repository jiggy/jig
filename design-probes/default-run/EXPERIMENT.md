# Defaults-only Run design probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This is coherent pseudocode against packages which do not exist yet. It is a
> falsification fixture, not a Starter or API commitment.

## Question under test

Can an exact, self-contained FLOW Run work from sane defaults without an
author-written Binding file, ambient authority, or a second execution path?

This project contains one Bun Run, one `flows` discovery source, and no
`bindings/` directory. During normalization Jig derives the one obvious
least-authority Binding named `greet`. That derived Binding enters the same
candidate, approval, lock, generation, root-admission, revocation, Runtime
Adapter, and Sandbox Backend machinery as an explicit Binding.

The derivation is deliberately narrow. A package qualifies only when it:

1. is Run-capable and contains exact code;
2. has no `uses` or `attachments`;
3. validates the complete settings value `{}`;
4. requires no instruction Agent or fallback; and
5. has an immediate directory LocalName equal to `FLOW.md.name`, no authored
   Binding owns it, and exactly one eligible member proposes it.

Services and host capabilities never acquire defaults. Required settings,
attachments, capability providers, Agent choice, or variants require an
explicit Binding.

## Falsification rules

The design fails if:

- default execution bypasses aggregate `plan`/`apply`;
- discovery itself runs code or grants live authority;
- the derived Binding's final Run receives project files, environment, raw
  network, child processes, host IPC, or an Agent;
- a Service mounts because its directory appeared;
- an authored Binding competes with a proposed default instead of owning its
  ID;
- ambiguous unowned defaults gain filesystem-order or semantic precedence; or
- materializing an equivalent explicit Binding changes runtime behavior.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Inspect `jig.ts` and confirm there is no Binding source.
3. Inspect `flows/greet/` and its future SDK dependency.
4. Tabletop `expected/`.
5. Challenge each surface through [`API-LEDGER.md`](API-LEDGER.md).

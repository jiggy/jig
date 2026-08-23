# GUI application architecture probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This project contains coherent pseudocode against Jig and FLOW APIs which do
> not exist. It is a falsification fixture, not a Starter or API commitment.

## Question under test

Can a small interactive application use Jig without making HTTP, browser code,
Journal queries, or GUI extension concepts part of FLOW?

The probe contains:

1. an ordinary trusted Bun application server and framework-free browser UI;
2. one file-backed FLOW Service providing read and write index capabilities;
3. one Python ingestion Run and one Bun search Run;
4. one explicit Journal publication Binding; and
5. Jig's host-local control surface for root submission, cancellation, Run
   inspection, and bounded Event inspection.

The application server is deliberately **not** a Flow. The user starts it as
ordinary application code. It may listen on localhost because it runs under
the user's application authority, not inside an untrusted FLOW sandbox. Its
Jig client is authenticated to one local project and can request only Jig
control operations; it cannot mutate project policy or obtain Flow effect
bindings.

The browser never talks to Jig directly. It receives a narrow application API
from the Bun server. Near-live Event display uses bounded polling over the
host-local inspection surface. FLOW's portable Journal capability remains
append-only and Service/1 gains no subscription or callback primitive.

## Falsification rules

The design fails if the scenario requires:

- raw network authority inside the index, ingestion, or search packages;
- a portable Journal query/subscription method;
- browser access to `.jig/` or a Jig coordinator credential;
- per-request Binding settings or attachment remapping;
- a universal FLOW GUI, route, panel, slot, or client-bundle format; or
- a second root-Run admission path with weaker idempotency or authority rules.

## Findings from the first tabletop pass

- Jig needs a small host-local control API, not a GUI framework. CLI, GUI, and
  trusted modules should share the same root submission operation.
- `startRun` alone is insufficient for a real frontend. Bounded `getRun`,
  idempotent `cancelRun`, and bounded forward `readEvents` inspection are also
  needed. These are Jig host APIs, not FLOW/1 methods or Capability Contracts.
- A client credential must be project-scoped and operation-scoped. Browser
  code never receives it.
- Polling is enough for v1. A host-local streaming convenience can be added
  later without changing FLOW, but this probe does not earn one.
- The GUI owns presentation and HTTP policy. Jig returns stable machine facts;
  it does not render domain objects or infer UI routes.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Trace `app/server.ts` and `app/public/app.js`.
3. Inspect the bindings and three FLOW packages.
4. Tabletop `expected/` and the authority delta.
5. Challenge each invented surface through [`API-LEDGER.md`](API-LEDGER.md).

# GUI application architecture probe

> **NON-RUNNABLE · NONNORMATIVE · DISPOSABLE**
>
> This project contains coherent pseudocode against Jig and FLOW APIs which do
> not exist. It is a falsification fixture, not a Starter or API commitment.

## Question under test

Can a small interactive application submit and inspect Jig Runs without making
HTTP, browser code, or GUI extension concepts part of FLOW?

The probe contains:

1. an ordinary trusted Bun application server and framework-free browser UI;
2. one file-backed FLOW Service providing read and write index capabilities;
3. one Python ingestion Run and one Bun search Run;
4. Jig's candidate local embedding surface for root submission, cancellation,
   and Run inspection.

The application server is deliberately **not** a Flow. The user starts it as
ordinary application code. It may listen on localhost because it runs under
the user's authority, not inside an untrusted FLOW sandbox. The probe does not
pretend that a caller-authored authority object can sandbox a same-user
process.

The browser never talks to Jig directly. It receives a narrow application API
from the Bun server. Run polling is sufficient for this application, so the
probe does not earn a Journal reader or streaming protocol.

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
- `startRun` alone is insufficient for this frontend. Bounded `getRun` and
  idempotent `cancelRun` are plausible host operations, but their package and
  transport spelling remains a candidate rather than a frozen standard.
- `@jigging/jig` is the intended product surface. The earlier `@jig/client`
  package and caller-authored authority object were unearned inventions.
- Polling Run records is enough. No Event reader, subscription, SSE, or
  WebSocket is needed.
- The GUI owns presentation and HTTP policy. Jig returns stable machine facts;
  it does not render domain objects or infer UI routes.

## Review order

1. Read [`SCENARIO.md`](SCENARIO.md).
2. Trace `app/server.ts` and `app/public/app.js`.
3. Inspect the three justified package Bindings and three FLOW packages.
4. Tabletop `expected/` and the authority delta.
5. Challenge each invented surface through [`API-LEDGER.md`](API-LEDGER.md).

# Engineering roadmap

This is Jig's long-term sequence of product outcomes. It is not a sprint plan,
status report, or promise that every later capability will be implemented.
Current work and blockers belong in `.tmp/`; shipped behavior belongs in the
public documentation and executable evidence.

## Ordering rule

Each stage must produce one useful end-to-end result before the next stage may
add vocabulary or machinery. A later stage may be skipped when the preceding
product is already useful or when independent evidence favors a simpler path.

## Outcome gates

1. **Direct local Flow.** A new user can install Jig, initialize and check one
   project, run one exact admitted Flow or Binding, receive a finite result,
   and leave no execution residue.
2. **Exact composition.** A Binding can map a small closed set of child slots,
   and a Flow can call those exact admitted children within one bounded root
   deadline without acquiring catalogue or scheduler authority.
3. **Agent-assisted routing.** One contained Agent call can return structured
   data used to select among a closed admitted set, while Jig—not the model—
   enforces eligibility and authority. An independent campaign must approve
   the authoring surface before this becomes a promoted public milestone.
4. **Useful software factory.** One admitted issue can drive a contained
   coding Agent over bounded disposable workspace authority, run exact declared
   checks, and return an inspectable patch and evidence while a human retains
   merge and release authority.
5. **External activation, if earned.** When a real outside fact must reliably
   start admitted work, implement the smallest durable activation seam the
   software-factory case proves necessary. Do not assume the old Journal or
   Hook designs are that seam.
6. **Demand-gated expansion.** Services, broader semantic discovery, project
   updates and three-way reconciliation, GUI/Cordis campaigns, extra runtimes,
   and Jig Graph over Sley proceed only when independent applications make
   their value and boundaries concrete.

Repository-wide simplicity, compatibility, probe, and host-boundary rules live
in the root [`AGENTS.md`](../AGENTS.md); this file owns only outcome ordering.

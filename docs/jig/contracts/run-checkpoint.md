---
title: Run Checkpoint contract
---

# Run Checkpoint contract

Run Checkpoint lets a Flow preserve completed results while other work
continues. If the Run is interrupted, its accepted progress can still reach
the operator after cleanup, without being presented as a successful Run.

`https://jig.md/contracts/run-checkpoint` identifies this interface. It is not
a storage endpoint or authority to access other Runs. Jig matches the
package-local descriptor offline; the operator reviews the capability and
chooses the output destination.

- [Contract and limits](../spec/run-checkpoint.md)
- [Exact JSON descriptor](https://jig.md/contracts/run-checkpoint.capability.json)
- [Repair application](../guide/tested-patch.md)

Retention lasts while the independent command owner lives. It is not
machine-crash recovery or automatic resumption.

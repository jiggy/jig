---
title: Run Checkpoint contract
---

# Run Checkpoint contract

Part of the [Jig standard library](index.md). With a `contracts` parent directory,
copy the installed agreement and its license using
`jig import-contract jig:run-checkpoint contracts/run-checkpoint`.

Run Checkpoint lets a Flow preserve completed results while other work
continues. If the Run is interrupted, its accepted progress can still reach
the operator after cleanup, without being presented as a successful Run.

`https://jig.md/contracts/run-checkpoint` identifies this interface. It is not
a storage endpoint or authority to access other Runs. Jig matches the
package-local descriptor offline; the operator reviews the native invocation and
chooses the output destination.

- [Contract and limits](../spec/run-checkpoint.md)
- [Exact JSON descriptor](https://jig.md/contracts/run-checkpoint/contract.json)

The latest accepted checkpoint shares the original protected attempt's bounded
48-hour retention. Ticket retrieval and explicit checkpoint export do not
restart execution. This is not automatic resumption or a guarantee against
hardware failure; native fencing and cleanup still gate publication.

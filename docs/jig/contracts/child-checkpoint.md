---
title: Child Checkpoint contract
---

# Child Checkpoint contract

Part of the [Jig standard library](index.md).
With a `contracts` parent directory, copy the installed agreement and its license:

```sh
jig import-contract jig:child-checkpoint contracts/child-checkpoint
```

Child Checkpoint lets a parent Flow read accepted work from a settled child call.
The successful retrieval supplies a held artifact for the complete saved tree, including associated artifacts.
The parent can inspect it and route useful work to another reviewed method.
The child's original result remains unchanged.

`https://jig.md/contracts/child-checkpoint` identifies this interface.
Jig matches the package-local descriptor offline and checks the caller's original child operation identity.
The contract does not grant access to another Run, sibling, or grandchild.

- [Contract, scope, and limits](../spec/child-checkpoint.md)
- [Exact JSON descriptor](https://jig.md/contracts/child-checkpoint/contract.json)
- [Save a checkpoint](run-checkpoint.md)

All checkpoints remain owned by the original root attempt.
Retrieval preserves execution status and does not replay work or decide application acceptance.

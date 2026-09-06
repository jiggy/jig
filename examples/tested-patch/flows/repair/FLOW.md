---
name: tested-patch
description: Repair one supplied TypeScript module and return a patch with independent acceptance-test evidence.
uses:
  agent:
    contract: ./contracts/agent-run.capability.json
outcomes:
  blocked: The defect was not reproduced or no acceptable patch was produced.
  limit: The Agent could not complete within its limit.
---

Supply an issue, a `snapshot` containing bounded text `files` and their
`sha256` identity, and one existing `editPath`. The checker and `checks.json`
are package-owned acceptance policy; they are not editable input. The snapshot
contains no dependencies requiring installation. This example supports a
synchronous exported function with JSON arguments and JSON return values.

The method tests the original through its exact `candidate` child slot, asks
its Agent for a replacement, and tests that replacement. A settled invalid
candidate result or genuine assertion failure permits exactly one correction
using the prior patch and observed failure: at most two Agent calls in total.
Cancellation, uncertainty, deadlines, and infrastructure failures do not retry.
Candidate source
never executes in this package. A separate fixed checker consumes the child's
observed values, records actual test-process termination and bounded logs, and
decides acceptance. Only a reproduced defect followed by passing patched
checks returns `done`. A failed patch remains in the output for inspection.

The result identifies the original snapshot and records an ordered `attempts`
array. Every valid proposal identifies its patched contents and contains a
unified patch against the original plus a full replacement. Completed checks
identify their program and case set. Checker exit
codes are not candidate-process exit codes; child failures propagate as
operation errors. No result claims correctness beyond the finite case set,
and no original repository, acceptance file, or external system is changed.
The recipient decides whether to apply, merge, or release the patch.

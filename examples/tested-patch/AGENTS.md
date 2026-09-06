# Tested patch

## Purpose

Turn one supplied defect into a bounded source replacement with independently
executed acceptance evidence. This is an authored, narrow application, not a
general repository worker or independent consumer proof.

## Ownership

- `flows/repair/` owns patch policy, at most two Agent calls, immutable acceptance checks,
  and the checker process. It handles candidate source only as data.
- `flows/evaluate/` evaluates the disposable candidate through one exact child
  slot, without Agent or other capability authority.
- `fixtures/` owns the synthetic UTF-8 utility repository and defect.
- `test/` owns deterministic application checks; host evidence is separate.

## Local Contracts

- Only the named existing source file may change; the original is input data,
  never a writable host repository. No merge, push, installation, or deployment.
- Candidate code executes only in the separate child Flow. The acceptance
  checker consumes bounded JSON observations, never source or commands.
- Checker exit codes and logs are observed process evidence. Child operation
  errors are not candidate OS exit records. Neither model prose nor a
  candidate-supplied pass flag is acceptance evidence.
- Use the same admitted checks for original and patch. Require an observed
  baseline mismatch before requesting a patch. Exactly one correction may
  follow a settled invalid candidate result or genuine assertion mismatch;
  feed the prior proposal and observed failure without changing the checks.
- A passed finite check set establishes only tested behavior. Do not claim
  purity, arbitrary repository support, or universal correctness.
- Cancellation, uncertain dispatch, deadlines, unavailable support, and other
  operational failures propagate without correction or replay.
- Retain every validated proposal against the original snapshot in `attempts`.
  Failed patched child calls retain the bounded proposals and baseline
  in existing operation-error details when terminal delivery remains possible.

## Work Guidance

- Keep provider choices with the operator and application policy in these
  packages. Do not add a workspace capability or host API for this example.

## Verification

- Install `flows/repair`'s declared SDK with `bun install --ignore-scripts`,
  then `bun test examples/tested-patch/test` checks deterministic application policy.
- Contained execution and real-Agent outcomes require separately retained
  admitted Jig Runs, including unsuccessful attempts and cleanup evidence.

## Child DOX Index

- None.

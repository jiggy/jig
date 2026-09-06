# Tested patch

## Purpose

Turn one supplied defect into a bounded source replacement with independently
executed acceptance evidence. This is an authored, narrow application, not a
general repository worker or independent consumer proof.

## Ownership

- `README.md` introduces the copyable application and points to its public guide.
- Root `package.json` and `bun.lock` own development-only test dependencies.
  Install them here so generated `node_modules` stays outside Flow packages.
- The two Flow-local `bun.lock` files are generated, tracked application inputs;
  they make a copied example reviewable without reconstructing dependency locks.
  The ignored repository workspace lock remains unrelated.
- `flows/repair/` owns patch policy, at most two Agent calls, immutable acceptance checks,
  the checker process, UTF-8 attachment validation, and evidence-checked file
  deliverables. It handles candidate source only as data.
- `issue.json` supplies the ordinary issue/edit-path input. Jig's public file
  interface owns capture, containment and packet delivery; there is no outer adapter.
- `flows/evaluate/` evaluates the disposable candidate through one exact child
  slot, without Agent or other capability authority.
- `fixtures/` owns the synthetic UTF-8 utility repository and defect.
- `test/` owns deterministic application checks; host evidence is separate.

## Local Contracts

- The repair root declares `source: read` and `deliverables: read-write`.
  Input contains only `issue` and `editPath`; accept at most 16 regular UTF-8
  source files totaling 64 KiB. Never execute source in the parent Flow.
- Write `summary.txt` and validated `proposal-N.patch` files for valid method
  outcomes. Write `review.patch` only after matching original, replacement,
  diff, checker, case-set, and passing-verdict evidence. No automatic application.
- Operational failures propagate; Jig suppresses partial Flow files on failure.
  Missing terminals remain missing evidence, not assertions about dispatch.
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

- At this application root, run `bun install --ignore-scripts --frozen-lockfile`,
  then `bun test examples/tested-patch/test` checks deterministic application policy.
- File tests cover bounded text input and contradictory evidence refusing
  review-ready deliverables. Host capture/publication tests remain owned by Jig.
- Contained execution and real-Agent outcomes require separately retained
  admitted Jig Runs, including unsuccessful attempts and cleanup evidence.

## Child DOX Index

- None.

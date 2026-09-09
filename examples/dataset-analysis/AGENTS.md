# Bounded dataset analysis

## Purpose

Make adaptive investigation reusable: a threshold-search method converses with
a separately replaceable dataset reader, while the application verifies its finding.

## Ownership

- `flows/analysis` owns bounded lower-bound search using identifiers and replies.
- `flows/dataset` owns request validation and copying explicit Celsius readings.
- `flows/investigate` owns input validation, exact child wiring, cleanup, and
  independent verification against the original dataset.
- `test/` owns deterministic application checks; installed host evidence belongs
  to Jig's tests. The public guide is owned by `docs/jig/`.

## Local Contracts

- Input is one finite JSON/1 threshold and 1–128 nondecreasing readings with
  unique bounded ASCII identifiers. Analysis receives no complete reading list.
- Two direct channels carry named request and Celsius-reply contracts. Identical
  package-local descriptors must stay synchronized; identities describe meaning,
  not a remotely fetched schema or a host-owned service.
- At most eight unique requests, one unanswered at a time. Reject duplicate,
  unexpected, missing, and extra replies. Close requests before requiring reply EOF.
- Keep both child results separate from stream completion. An unsuccessful
  participant stops its sibling. Root cancellation and uncertain ownership cannot
  become a successful finding. Retain useful observed prefixes on bounded failure.
- No Agent, network, filesystem attachment, arbitrary command, or fault-injection
  setting belongs in this application.

## Work Guidance

- Keep each Flow self-contained and exercise existing public SDK methods.
- Failure simulations belong in tests, not recommended application modes.

## Verification

- `bun test examples/dataset-analysis/test` exercises application policy and
  synthetic channel conversations after ordinary development dependency preparation.
- Pure application pipes do not establish transport, containment, or host cleanup;
  qualify the prepared application through the installed Jig interface separately.

## Child DOX Index

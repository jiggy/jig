# Live Agent progress

## Purpose

Show public Agent progress during one bounded call, with application-owned
filtering and a separate execution result.

## Ownership

- `flows/chat/` owns input validation, the Agent call, progress filtering, and
  optional publication through the root's `progress` channel.
- `test/` owns deterministic application checks, not native-client evidence.
- `README.md` teaches ordinary invocation; Jig's public guide owns host setup.
- Root and Flow manifests declare authoring dependencies on the current SDK.
  The repository build/distribution path assembles `live-agent.tar.gz` with a
  self-contained Flow from the matching packed SDK. The release archive owns
  the prepared runnable dependency closure; this directory is authoring source.

## Local Contracts

- One Agent call, no child Flows, tools, attachments, retries, or credentials.
- Agent updates use the exact optional named contract. The application prints
  public text fragments, ignores plans, and can suppress progress entirely.
- Suppression affects progress only; the actual Agent result remains intact.
- Optional output-channel failure and input-stream failure are reported as
  incomplete progress, independently of the Agent outcome.
- Await both observation settlement and the Agent result. Root cancellation,
  uncertain ownership, and cleanup failures cannot become success.

## Work Guidance

- Use the ordinary public FLOW SDK; no example launcher or private helpers.
- Keep provider configuration with the operator and dependency preparation
  with the repository build/distribution path, not the user's quickstart.

## Verification

- After preparing the current SDK dependency, `bun test examples/live-agent/test`
  checks filtering and independent results. Release checks install the current
  packed SDK into a disposable application copy.
- Installed native-client qualification belongs to Jig's host evidence.

## Child DOX Index

- None.

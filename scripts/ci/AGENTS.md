# CI host provisioning

## Purpose

Owns disposable Linux proof-host provisioning and rootless Mac candidate
qualification. Host preparation never becomes a consumer requirement.

## Ownership

- `provision-github-rootless-host.sh` owns provision, cleanup, and clean-state
  assertions for that runner.
- `qualify-macos-host.sh` owns exact Intel macOS 14.4.1 build 23E224 and
  Bun 1.4.2 and real Node 22+ preflight, frozen same-revision archives with
  digest rechecks, sequential native tests, installed-consumer checks, and
  comparison of owned host residue before and after qualification.
- The matching Linux and Mac host-conformance workflows own runner selection.

## Local Contracts

- Mac qualification runs unprivileged without host provisioning. Require all
  three genuine native client paths; missing prerequisites fail explicitly.
  No model credentials or online model calls are part of this host check.
- Use `sudo` only while provisioning the disposable runner. Jig and package
  code run unprivileged.
- Keep fetched host tools version- and digest-pinned.
- Preserve the distinction between inherited and newly acquired cgroup
  authority, and require zero Jig residue at completion.
- Never expose privileged host controls to Flow or project code.

## Work Guidance

- Review the matching host-conformance workflow in the same change.

## Verification

- Exercise provision, the hostile suite, cleanup, and `assert-clean` on a
  disposable supported runner.

## Child DOX Index

- None.

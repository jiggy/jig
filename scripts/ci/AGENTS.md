# CI host provisioning

## Purpose

Owns the privileged preparation and cleanup of disposable GitHub runners used
for Jig's rootless hostile-host evidence.

## Ownership

- `provision-github-rootless-host.sh` owns provision, cleanup, and clean-state
  assertions for that runner.
- `.github/workflows/linux-host-conformance.yml` owns when and where it runs.

## Local Contracts

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

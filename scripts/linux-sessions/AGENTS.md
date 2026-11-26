# Delegated Linux sessions

## Purpose

Help operators run stock Jig in an existing Linux session with delegated cgroups.

## Ownership

- `nixos.nix` configures one delegated systemd unit per session.
- `enter-systemd-session.sh` enables controllers before the session starts.
- `acceptance-project.sh` creates a disposable, dependency-free consumer project.
- `observe-cgroup.sh` checks live execution or cgroup removal from the host.
- [The setup guide](../../docs/jig/start/delegated-linux.md) owns the public procedure and qualification status.

## Local Contracts

- The operator supplies the foreground session command and working directory.
- Start the reference units only on operator request.
- Each unit owns its own cgroup subtree. Run one contained Jig command at a time per unit.
- Run the acceptance project with an installed Jig artifact and its public CLI.

## Work Guidance

Keep acceptance independent of the session manager and this checkout's build tools.
Recheck the pinned profile when Jig or its required host mechanisms change.

## Verification

Parse and evaluate the NixOS module, then check the shell scripts with Bash.
Use the guide's installed acceptance procedure on the host under qualification.

## Child DOX Index

- None.

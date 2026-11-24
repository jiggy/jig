# NixOS reference

## Purpose

Help operators run stock Jig in a restricted agent session.

## Ownership

- `agent-sessions.nix` provisions one delegated systemd unit per worktree.
- `enter-session.sh` activates controllers in that unit before the agent starts.
- `acceptance-project.sh` creates a disposable, dependency-free consumer project.
- `observe-scope.sh` checks live execution or cgroup removal from the host.
- [The setup guide](../../docs/jig/start/nixos-agent-session.md) owns the public procedure and qualification status.

## Local Contracts

- The operator supplies the existing sandbox command and worktree.
- Start the reference units only on operator request.
- Each unit owns its own cgroup subtree. Allow one active Jig command per unit.
- Run the acceptance project with an installed Jig artifact and its public CLI.

## Work Guidance

Keep the setup independent of Orca APIs and this checkout's build tools.
Recheck the pinned profile when Jig or its required host mechanisms change.

## Verification

Parse and evaluate the NixOS module, then check the shell scripts with Bash.
Use the guide's installed acceptance procedure on the designated Orca host.

## Child DOX Index

- None.

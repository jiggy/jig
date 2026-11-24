---
title: Run Jig in a NixOS agent session
description: Provision isolated worktree sessions and validate stock Jig inspection, review, runs, and cleanup.
---

# Run Jig in a NixOS agent session

This reference is a candidate for an operator-managed NixOS host.
The Orca lifecycle checks below are pending.
Use a dedicated, unprivileged runner account and a separate disposable worktree for each session.

## Configure the host

Use an x86_64 host with the [Jig host prerequisites](./index.md#supported-host).
The reference uses systemd 254 or later to place the session in its initial cgroup.
Pin the host package set and use the same exact installed Jig build in both sessions.
The [Jig Nixpkgs pin](https://github.com/jiggy/jig/blob/main/shell.nix) provides a starting package set.

Fetch the [reference directory](https://github.com/jiggy/jig/tree/main/scripts/nixos) from one Jig revision.
Import its module into your NixOS configuration. Point each command at the existing sandbox launcher for that session.

```nix
{
  imports = [ ./jig-nixos/agent-sessions.nix ];

  jig.agentSessions = {
    first = {
      user = "orca-runner";
      worktree = "/srv/orca/first";
      command = [ "/etc/orca/launch-first" ];
    };
    second = {
      user = "orca-runner";
      worktree = "/srv/orca/second";
      command = [ "/etc/orca/launch-second" ];
    };
  };
}
```

Replace the example account, paths, and commands with your operator-owned values.
Use foreground sandbox commands that stay alive for the whole session.
Apply the configuration through your normal NixOS workflow.
Start `jig-agent-first.service` and `jig-agent-second.service` from the host.
Connect to the agents through their usual interface.

Systemd delegates CPU, memory, and process controllers to each unit.
The startup script enables them in its own subtree before it starts the sandbox.
Jig checks the inherited authority, then owns containment and cleanup for each Run.
Use one active Jig command per unit, and wait for cleanup before starting another.

The existing session policy still owns worktree, Nix store, network, and socket access.
Allow Jig to see its own delegated cgroup and run nested Bubblewrap inside that policy.
Preserve `JIG_BWRAP_PATH` from the unit if the sandbox filters its environment.
Keep the host systemd control socket outside the agent's permissions.
Landlock filesystem restrictions block mount topology changes even with pre-provisioned cgroups.
[Linux Landlock documentation](https://www.kernel.org/doc/html/v6.18/userspace-api/landlock.html#filesystem-topology-modification)

If the existing Orca launch cannot inherit this delegation, record how it starts and places the agent.
Keep the failing case with the qualification results.

## Check inspection, review, and a normal Run

Run these commands inside each agent session from its disposable worktree.
Set `reference` and `jig` to the absolute paths of the reference directory and installed binary.
Check that `"$jig" inspect --help` lists `--flow`.
Use an installed artifact from the reference revision if the published alpha lacks this option.
The fixture uses only the packaged runtime and has no dependencies or grants.

```bash
project=$(bash "$reference/acceptance-project.sh" "$jig") &&
cd "$project" &&
"$jig" inspect --flow --topology &&
"$jig" review --yes &&
"$jig" run flow:flows/lifetime --input 0 --json &&
sed -i "s/revision: 'first'/revision: 'second'/" flows/lifetime/FLOW.ts &&
"$jig" inspect --flow --topology &&
"$jig" review --yes &&
"$jig" run flow:flows/lifetime --input 0 --json
```

Expect `succeeded` and `childStarted: true` from both Runs.
Expect `revision: first` before the edit and `revision: second` after the second review.
From the host, check that each unit has removed its execution subgroups.

```bash
bash "$reference/observe-scope.sh" settled jig-agent-first.service
bash "$reference/observe-scope.sh" settled jig-agent-second.service
```

## Check overlapping Runs

From the second session, start a peer Run that stays active for two minutes.

```bash
"$jig" run flow:flows/lifetime --input 120000 --timeout 150s --json
```

From the first session, start the Run under test and retain its exact PID.
Choose a new log name per case. Use a 30-second timeout for the deadline case.

```bash
case_name=cancel
time_limit=90s
"$jig" run flow:flows/lifetime --input 60000 --timeout "$time_limit" --json \
  > "$case_name.json" 2> "$case_name.stderr" &
jig_pid=$!
printf 'Jig command PID: %s\n' "$jig_pid"
```

From the host, verify both worktree units have a populated execution subgroup.
Record both paths. The peer check must identify the same subgroup after the first Run stops.

```bash
bash "$reference/observe-scope.sh" running jig-agent-first.service
peer_group=$(bash "$reference/observe-scope.sh" running jig-agent-second.service)
```

Test each case with a fresh pair of Runs.

| Case | Action in the first session | Expected evidence |
| --- | --- | --- |
| Cancel | Send `kill -TERM "$jig_pid"` | Jig reports cancellation. |
| Deadline | Let the 30-second timeout expire | Jig reports `DEADLINE_EXCEEDED`. |
| Coordinator loss | Send `kill -KILL "$jig_pid"` | The Jig command exits by signal. The session stays up. |

Use only the PID of the live Jig command you just started.
After each action, collect the exit status.
Keep the JSON and stderr logs even if the killed coordinator emits no terminal.

```bash
exit_status=0
wait "$jig_pid" || exit_status=$?
printf '%s\n' "$exit_status" > "$case_name.exit"
```

From the host, repeat the following checks until cleanup settles.
Record a failed check if the subgroup remains after 15 seconds or the peer changes.

```bash
bash "$reference/observe-scope.sh" settled jig-agent-first.service
test "$peer_group" = "$(bash "$reference/observe-scope.sh" running jig-agent-second.service)"
```

Wait for the peer to return `succeeded`.
Check that its unit also reaches `settled`.

## Retain the evidence

Record the Jig build, Nixpkgs pin, kernel, systemd, Bubblewrap, and Orca sandbox revisions.
Include case outputs, exit statuses, and both scopes' observations.
Report the first unmet condition alongside any successful cases.
Keep dependency proxy qualification separate from this fixture.

Re-run these checks when the profile or Jig's relevant host requirements change.
The [containment contract](../spec/project-policy.md#containment-and-lifetime) defines the enforcement and cleanup that the reference must preserve.

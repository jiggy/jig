---
title: Run Jig in a delegated Linux session
description: Use an existing Linux session and verify stock Jig inspection, review, execution, and cleanup.
---

# Run Jig in a delegated Linux session

Use stock Jig from an operator-managed session on Linux.
The operator delegates a cgroup subtree to the session.
Jig uses that subtree to enforce its ordinary execution and cleanup rules.
See the [session requirements](../reference/configuration.md#use-an-existing-delegated-linux-session).

## Prepare the host

Use an unprivileged account on an x86_64 host with the [Jig host prerequisites](./index.md#supported-host).
Both setups below use systemd 254 or later to place each session in its initial cgroup.
Pin the host package set and use the same installed Jig build in both sessions.
The [Jig Nixpkgs pin](https://github.com/jiggy/jig/blob/main/shell.nix) provides a starting package set.

Fetch the [reference directory](https://github.com/jiggy/jig/tree/main/scripts/linux-sessions) from one Jig revision.

## Start transient user services

The host test used two transient user services under the same NixOS runner account.
Both sessions passed inspection, review, and execution before and after an edit.
The operator confirmed cgroup cleanup after cancellation, deadline expiry, and coordinator loss.
In each case the peer Run stayed active and finished. [Host acceptance report](https://github.com/jiggy/jig/pull/198#issuecomment-7142275963)

Start the services from a trusted Bash terminal under the runner account.
This setup uses the existing systemd user manager without host `sudo`.
The user manager must be able to delegate the CPU, memory, and process controllers.
Start from the first disposable directory.
Set `reference` and `bwrap_path` to the absolute paths of the reference directory and Bubblewrap executable.

```bash
unit=jig-session-first.service
systemd-run --user --pty --wait --collect --service-type=exec \
  --unit="$unit" --working-directory="$PWD" \
  --property='Delegate=cpu memory pids' --property=DelegateSubgroup=jig \
  --setenv="PATH=$PATH" --setenv="JIG_BWRAP_PATH=$bwrap_path" \
  --expand-environment=no \
  -- "$BASH" "$reference/enter-systemd-session.sh" "$unit" "$BASH" --norc -i
```

Repeat in a second terminal from the other disposable directory with `unit=jig-session-second.service`.
Keep both shells open during the checks.
Exit each shell after its checks finish. Systemd collects the transient service.

## Configure persistent system units

Use the NixOS module when the host operator manages the session units in system configuration.
Live lifecycle checks for the module are pending.
Import its module into your NixOS configuration.
Point each command at the entrypoint for that session.

```nix
{
  imports = [ ./linux-sessions/nixos.nix ];

  jig.delegatedSessions = {
    first = {
      user = "runner";
      workingDirectory = "/srv/projects/first";
      command = [ "/etc/local/bin/start-session" "first" ];
    };
    second = {
      user = "runner";
      workingDirectory = "/srv/projects/second";
      command = [ "/etc/local/bin/start-session" "second" ];
    };
  };
}
```

Replace the example account, paths, and commands with your operator-owned values.
Use a foreground command that stays alive for the whole session.
Apply the configuration through your normal NixOS workflow.
Start `jig-session-first.service` and `jig-session-second.service` from the host.
Connect to each session through its usual interface.

## Preserve the session boundary

Systemd delegates CPU, memory, and process controllers to each unit.
The startup script enables them in its own subtree before it starts the session.

If you use an outer sandbox, preserve its existing access policy.
That policy must permit Jig to use its own delegated cgroup and run Bubblewrap.
Preserve `JIG_BWRAP_PATH` from the unit if the sandbox filters its environment.
Provisioning takes place on the host and needs no systemd control socket access from the session.
Landlock filesystem restrictions block mount topology changes even with pre-provisioned cgroups.
[Linux Landlock documentation](https://www.kernel.org/doc/html/v6.18/userspace-api/landlock.html#filesystem-topology-modification)

## Check inspection, review, and a normal Run

Use two sessions with independent delegations.
Run these commands inside each session from a separate disposable directory.
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

From the host, check that each delegated subtree has no execution subgroups.
Set `first_leaf` and `second_leaf` to each session's absolute cgroup path.
For a systemd setup, use the unit's cgroup path with its `jig` subgroup.
Run this lookup from a third, trusted terminal.
Set `reference` in that terminal too.
For system-level units, set `manager=(systemctl)` in the first line.

```bash
manager=(systemctl --user)
first_leaf="/sys/fs/cgroup$("${manager[@]}" show -p ControlGroup --value jig-session-first.service)/jig"
second_leaf="/sys/fs/cgroup$("${manager[@]}" show -p ControlGroup --value jig-session-second.service)/jig"
```

```bash
bash "$reference/observe-cgroup.sh" settled "$first_leaf"
bash "$reference/observe-cgroup.sh" settled "$second_leaf"
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

From the host, verify both delegated subtrees have a populated execution subgroup.
Record both paths. The peer check must identify the same subgroup after the first Run stops.

```bash
bash "$reference/observe-cgroup.sh" running "$first_leaf"
peer_group=$(bash "$reference/observe-cgroup.sh" running "$second_leaf")
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
bash "$reference/observe-cgroup.sh" settled "$first_leaf"
test "$peer_group" = "$(bash "$reference/observe-cgroup.sh" running "$second_leaf")"
```

Wait for the peer to return `succeeded`.
Check that its subtree also reaches `settled`.

## Retain the evidence

Record the Jig build, Linux distribution, kernel, Bubblewrap, and session configuration.
For the NixOS reference, include the Nixpkgs and systemd revisions.
Include case outputs, exit statuses, and both scopes' observations.
Repeat this procedure through the normal session launcher to qualify that integration.
Report the first unmet condition alongside any successful cases.

Re-run these checks when the profile or Jig's relevant host requirements change.
The [containment contract](../spec/project-policy.md#containment-and-lifetime) defines the enforcement and cleanup that the reference must preserve.

# Inherited rootless acquisition checkpoint

**Status:** private acquisition logic completed on 2026-08-31. This closes
recognition of one already-inherited delegated Linux envelope. It does not
create cgroup authority or make the installed Project Session operational.

## Decision

The first alpha does not register, install, or search for a Sandbox Backend.
It recognizes only the complete rootless authority already inherited by the
current Jig process.

The private acquisition function:

1. parses the one unified cgroup-v2 membership from `/proc/self/cgroup`;
2. considers only the current cgroup's immediate parent;
3. requires that parent to be empty, owned by the current unprivileged user,
   writable, exclusive to the current payload child, and delegated with active
   CPU, memory, and PID controllers;
4. requires the exact control files needed by a child Run;
5. resolves only fixed `/usr/bin/bwrap`, rejects setuid/setgid or non-regular
   executables, requires version 0.12 or newer, and executes the complete
   feature probe; and
6. returns either one immutable internal observation or the bounded
   `SANDBOX_UNAVAILABLE` error.

It never scans higher ancestors, moves the coordinator, activates
controllers, contacts a user service manager, searches `PATH`, reads an
`AGENT_*` variable, installs a package, or manufactures authority.

## Why inherited authority is required

An unprivileged child cannot delegate cgroup controllers to itself. That
authority must already come from an ancestor such as an ordinary service
manager, container launcher, CI executor, or development sandbox. A later
installed CLI may re-execute itself through a normal user service manager on
supported hosts, but that is a separate acquisition path and is not needed to
recognize an already-delegated invocation.

When neither inherited delegation nor a supported manager path exists, the
correct result is `SANDBOX_UNAVAILABLE`. There is no process-limit,
process-group, `/proc`-polling, privileged, or unsafe fallback.

## Evidence

The deterministic corpus passes 13 tests and 58 expectations. It covers:

- one exact successful observation;
- non-cgroup-v2 and ambiguous membership;
- root, ownership, population, sibling, controller, and control-file
  failures;
- setuid and obsolete Bubblewrap rejection;
- a failed feature probe with sanitized outward error; and
- refusal to search a usable grandparent after the immediate parent fails.

The complete Jig TypeScript build passes with the new private module.

The current development shell at the time of this checkpoint is intentionally
not delegated to uid 1000 and therefore returns `SANDBOX_UNAVAILABLE`. Review
197 remains the real delegated-host execution proof. Rerunning the durable
rootless hostile join requires an equivalent delegated host profile.

## Non-decisions

This checkpoint adds no setup command, daemon, host registration, public
Backend SPI, runtime acquisition, persistent service, or portable FLOW field.

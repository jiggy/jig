# Private finite foreground checkpoint

**Status:** closed on 2026-08-28 as one proof-host-only project session in
commit `e7bf8d9`. This checkpoint composes already earned private mechanisms;
it does not publish a CLI, project API, daemon, supervisor, Service host, or
runtime/sandbox extension interface.

Review 163 supersedes the `plan` sequence below with an opaque both-head base
and failure-atomic final Candidate/Plan publication. Reviews 155 and 162 close
the mixed-composition seam which this dated checkpoint still names as next.

## 1. Three operations stay distinct

The private foreground script now exposes three deliberately separate
commands:

```text
plan  <project-root>
apply <project-root> --plan <digest> --yes
run   <project-root> [--request <json>]...
```

They represent three different decisions:

```text
plan
    capture and retain current project source
    -> select exact proved private recipes
    -> publish Candidate/5
    -> bind classification to that exact candidate head
    -> return unchanged or one applicable Plan/2

apply
    require explicit local confirmation
    -> consume only the retained Plan digest
    -> return an admission or lock-repair receipt

run
    use only the already active admission
    -> recover and settle prior owned root work
    -> submit zero or more explicit Root Administration requests
    -> return their durable statuses
```

There is no `apply-run`. Reviewing policy does not silently execute it, and a
root submission cannot smuggle a Plan or admission change into execution.
Apply accepts both of the operation kinds already closed by Plan/2: an
authority-changing admission and an inert lock repair.

## 2. One finite controller session

`run` opens the existing project coordinator and Root Administration
controller. Opening first fences or classifies older-epoch work and pumps
current pending root and Hook work. The command then drains accepted work to a
fixed point and always disposes the controller and coordinator in `finally`.

The command accepts zero requests. That form exists so trusted foreground
operation can recover, pump, and drain already durable work without creating a
new root. When requests are supplied, this first proof intentionally processes
them in argument order:

```text
start request 1 -> drain -> read terminal status
start request 2 -> drain -> read terminal status
...
```

The underlying controller may execute independently rooted work which it
discovers while draining, but this script does not promise parallel submission
or scheduling policy. Sequential submitted roots keep the proof and user
expectation small. A future product frontend may add concurrency only after a
real requirement and its status/cancellation semantics are reviewed.

The session is finite. It does not watch project files, listen on a socket,
restart itself, retain project authority after the command exits, or establish
a daemon lifecycle.

## 3. Retained-source and composition witness

The hostile foreground fixture contains two admitted targets:

```text
direct Python Run

Bun parent Run
    -> one deterministic flow/call
    -> Python child Run
```

After planning, the test replaces the visible Python program with a failing
program before apply and run. Both the direct request and composed request
still execute the exact retained reviewed Package/1 bytes. The direct Run
returns the supplied input. The Bun parent receives the successful Python
child result through the already proved deterministic child-Flow operation.
Visible editable source therefore cannot substitute bytes after review.

The same foreground path then restores equivalent visible source, removes
`jig.lock`, plans a `lock-repair`, and applies it through the same separate
`apply` command. The receipt is a repair receipt, not an admission or Run.

## 4. Security and cleanup evidence

The real witness uses the authenticated sandbox-lifetime Bun and Python
runtime receipts and the existing private cgroup-v2/Bubblewrap Backend. It
does not infer ambient runtimes or expose host controls to the package.

After direct execution, composed child execution, repair, controller drain,
and disposal, the hostile check observes:

```text
residual Jig Run cgroups             0
residual Jig private device dirs     0
```

The checkpoint adds no weaker fallback and no new security abstraction.

## 5. What remains absent

This proof does not add:

- a persistent project supervisor or daemon;
- Service startup, Service leases, or Root-to-Service invocation;
- automatic project watching, plan approval, or apply;
- public project opening, authentication, transport, list/watch/cancel, or
  authority inspection;
- a public Plan, lock, Runtime Adapter, or Sandbox Backend schema; or
- parallel foreground request semantics.

The script remains under `packages/jig/scripts/`, exports no API, and contains
proof-host construction which cannot become a product shortcut.

## 6. Next earned seam

Mixed composition is next. One finite controller epoch should start one exact
admitted Service generation and let authentic root Runs use both existing
effect branches:

```text
root effect/call -> canonical Journal append
root effect/call -> exact acknowledged Service export
```

That vertical must phase recovery and shutdown correctly: fence/close root
operations, close Service invocations, release owner-slot leases, then fence
and release the Mount. Only after that witness should Jig reconsider a
persistent supervisor, automatic Service restart, or broader effect
dispatch.

The boundary is:

> The private foreground can now review, approve, and operate one admitted
> project in finite sessions without collapsing those acts into one command.
> It proves product flow, not a product interface.

# Packed Jig tooling and external-alpha disposition

**Status:** package-hygiene checkpoint closed on 2026-08-28. The repository
contains one private packed tooling candidate. It does not contain an operable
Jig-host alpha and is not ready for registry publication.

## 1. Exact artifact boundary

The `@jigging/jig` tarball now uses an explicit file allowlist. Its supported
contents are limited to:

```text
public JavaScript entrypoints and their declarations
    project authoring values
    Root Administration values and types
    explicitly experimental Hook authoring values

exported machine schemas
    Project Authoring/1
    Root Administration/1

one inert CLI
    jig package check

the exact package-local support-module and declaration closure needed by those
entrypoints
```

The packed tree excludes `dist/internal/**`, evaluator bundles, Runtime and
Sandbox machinery, project controllers, runtime recipes, Run and Service
hosts, proof scripts, hostile fixtures, and design-only source. Package
`exports` remains the consumer boundary; a required helper in a public module
does not thereby become a separate interface.

The installed-artifact smoke test now:

1. builds and packs the package;
2. installs the tarball into an empty consumer;
3. compares every installed package member against the exact allowlist;
4. rejects any `dist/internal/**` member;
5. invokes the installed `.bin/jig package check` against one valid
   instruction Flow;
6. exercises every public JavaScript and schema entrypoint under Bun;
7. type-checks independent TypeScript consumers against installed
   declarations.

The release script includes this packed Jig gate. It remains an unprivileged
source/artifact gate; it neither runs the Linux hostile suite nor establishes
publication readiness.

## 2. Evidence and current compatibility stop

The TypeScript build and focused package-check, package-inspection, and Root
Administration tests pass: 26 tests and 104 assertions. On this host, the
packed test completes exact-tree, installed-CLI, Bun, schema, and TypeScript
checks. The FLOW SDK package smoke separately requires an absolute
`FLOW_NODE`, verifies an exact Node-only identity sentinel, and does not search
`PATH`. This prevents `true`, Bun, or Bun's lifecycle-only `node` shim from
falsely satisfying the SDK's independent Node compatibility gate.

The FLOW SDK packed artifact passes under a genuine host-supplied Node 24. A
separate Jig compatibility experiment reached genuine Node 22 and Node 24 and
correctly refused both: each reports Unicode 17.0 while Package/1 requires
Unicode 15.1 NFC. The first Jig tooling and host preview is therefore selected
as Bun-only. Node is not in its release matrix. Adding Node later requires a
bounded Unicode 15.1 normalization implementation and the relevant
conformance corpus; the gate must not weaken Package/1 or call a newer Unicode
database equivalent.

Host-owned Python and `build` receipts separately pass wheel, source
distribution, and clean-install smoke. Those are release-environment inputs,
not Jig runtime discovery or package-manager behavior. The aggregate release
script retains Node only for the portable FLOW SDK compatibility gate.

The separate Node refusal is not a defect in the narrow Bun-validated artifact
and does not narrow FLOW, but it forbids a Node support claim for Jig.

## 3. The only honest preview claim

The present artifact may be described as:

> A private, Bun-validated packed candidate for inert Jig Project Authoring
> SDK/1 values, Root Administration/1 values and types supplied to trusted
> host code, explicitly experimental Hook authoring values, the two exported
> schemas, and `jig package check`.

It may not be described as a Jig host, runner, daemon, project controller, or
operational alpha. In particular, the artifact cannot:

- open or authenticate a project;
- issue Root Administration authority;
- plan, review, apply, or inspect project policy;
- register or select Runtime Adapters or Sandbox Backends;
- start a root Run by itself;
- host Services, Agents, Hooks, or Semantic Choice; or
- update a project or initialize a Starter.

`private: true` and version `0.0.0` remain deliberate. The manifest has no
license, repository, engine range, or publication metadata. Selecting those
values before licensing and minimum-runtime tests would manufacture a release
promise rather than close one.

## 4. Operational-alpha blocker

The proof host succeeds because an administrator supplies protected launch,
helper, subreaper, and sandbox-lifetime runtime evidence. Those mechanisms are
test evidence, not an installation contract. A supported operational alpha
needs an administrator-owned installation on a fresh host which provides:

```text
one narrowly authorized trusted launcher/helper
    + retained exact runtime support
    + protected host policy and admitted state
    + reacquisition and drift refusal across coordinator restart
```

FLOW code must receive none of that authority. Jig must authenticate the
registered evidence and produce exact `UNAVAILABLE` when it is missing or has
changed. One cgroup-v2/Bubblewrap mechanism still does not earn a public
Runtime Adapter or Sandbox Backend SPI, and the proof host's use of Nix still
does not earn a Jig Nix subsystem.

## 5. Product-control blocker

Even with a production trust root, the packed artifact would not be a usable
host alpha. The smallest missing product path remains:

```text
trusted local project acquisition
    -> authority-neutral plan with one closed public result/error model
    -> explicit apply by retained Plan digest
    -> finite local start/status through already-issued authority
```

The first operation must wrap the existing private pipeline whose final
Candidate/Plan publication is failure-atomic. It must not expose private
store, runtime-recipe, coordinator, cgroup, or helper concepts. Only the
surface consumed by an independent packed client may be frozen.

Cancellation, list/watch, daemon transport, automatic Service supervision,
public Backend/Adapter registration, updates, and `jig init` remain later
product decisions. They are not required to close this first local operation.

## 6. Release decision

This checkpoint earns package hygiene, not publication. Public release remains
blocked until all of the following are true:

1. an explicit license and registry metadata are selected;
2. the exact claimed Bun Jig gate and every separately claimed FLOW SDK or
   Flow-runtime gate pass in a trusted release environment;
3. a fresh supported host supplies the production trust-root contract; and
4. the narrow local project plan/apply/run path passes an independent consumer
   without importing private modules.

The correct result today is a clean private artifact plus exact blockers, not
an inflated alpha label.

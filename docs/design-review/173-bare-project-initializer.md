# Bare project initializer

**Status:** closed on 2026-08-29 as an inert tooling checkpoint. This does not
open, install, plan, admit, or execute a Jig project.

## 1. Earned surface

The packed private `@jigging/jig` command now accepts exactly:

```console
jig init --bare <new-directory>
```

It creates this fixed user-owned source tree:

```text
<new-directory>/
├── .gitignore
├── jig.ts
├── package.json
├── tsconfig.json
├── flows/
└── bindings/
```

`jig.ts` explicitly opts into shallow discovery for `./flows` and
`./bindings`. The empty project contains no Flow, Binding, Hook, Agent,
Service, lock, example, host policy, or hidden Starter dependency. Its package
manifest pins the same Jig version which emitted it.

The initializer is intentionally not a library export. `dist/bare-init.js` is
allowlisted only because the installed `jig` executable needs it.

## 2. Destination ownership

The command requires a nonexistent destination. It claims the final pathname
with one non-recursive `mkdir`; `EEXIST` is a closed
`JIG_INIT_DESTINATION_EXISTS` result. It never renames over or recursively
removes an existing destination.

After claiming the directory it creates only the six fixed entries and uses
exclusive creation for files. On an ordinary synchronous failure it attempts
to remove only entries that invocation recorded as created, in reverse order,
using non-recursive `unlink` and `rmdir`. Cleanup continues after an individual
failure. Unknown concurrent content is never recursively erased; if it
prevents cleanup, the command returns `JIG_INIT_CLEANUP_FAILED` and leaves the
residue for inspection.

This local inert generator is not a transaction manager. The tree may be
partly visible while the command runs, and process or machine loss may leave a
partial destination which a later invocation refuses to replace. The later
descriptor-held Project acquisition boundary—not initialization—is the
security and authority boundary. No Linux-only `renameat2`, daemon, journal,
or recovery protocol is justified for six inert files.

## 3. Evidence

Focused tests prove:

- the exact generated tree and bytes;
- closed existing-destination and unavailable diagnostics;
- cleanup of only invocation-owned entries after controlled failure;
- preservation of unknown concurrent content;
- exactly one winner between concurrent initializers; and
- installed-package execution plus type-checking of generated `jig.ts`
  against the packed public Project Authoring surface.

The Jig build, eight focused CLI tests with 43 assertions, and the packed
package smoke pass.

## 4. Explicit nonclaims

This checkpoint does not provide:

- `jig init --from`, Starter resolution, questionnaires, or Starter algebra;
- dependency installation;
- public project acquisition or the operational plan/apply/run CLI;
- host Runtime Adapter or Sandbox Backend configuration;
- crash-atomic whole-tree publication or automatic residue recovery; or
- an operable external alpha while the package remains private `0.0.0` and
  the production host trust root remains open.

The next application Starter remains gated on the actual Agentic Routing and
Event Source surfaces it consumes. The bare initializer does not pull those
later verticals forward.

# Static author closure checkpoint

**Status:** implemented private checkpoint. It publishes no capture, evaluator,
project-aggregate, or Sandbox Backend API.

The single-module evaluator proved the process boundary but intentionally made
ordinary declaration reuse impossible. This checkpoint adds the smallest
closed TypeScript graph needed by real `jig.ts` and Binding declarations
without turning Jig into a general TypeScript loader.

## 1. Accepted graph

One capture accepts one or more explicit `.ts` entry paths beneath one opened
Linux project-root descriptor. Runtime-bearing imports are limited to:

- the exact evaluator-provided `@jigging/jig` authoring module; and
- static ESM imports or re-exports using an explicit relative `.ts` path.

There is no extension guessing, directory index, `tsconfig` path mapping,
`node_modules` search, URL, built-in, other bare specifier, CommonJS `require`,
or dynamic import. Type-only imports are erased by Bun's TypeScript scanner and
therefore do not enter the runtime closure. Import cycles reject rather than
inheriting JavaScript's cycle-order semantics.

The private checkpoint bounds the graph to 256 modules, 1,024 runtime import
edges, 1 MiB per module, and 1 MiB of source across the complete closure. These
are implementation safety limits, not public FLOW limits.

## 2. Capture and identity

All entries and discovered modules are opened descriptor-relatively beneath
the same project root. Every segment rejects symlinks; modules must be regular,
singly linked, stable across their bounded read, valid UTF-8, canonical project
paths, and outside protected `.jig` state. Every selected file is reopened and
verified before publication. Source change retries the complete closure, never
one module in isolation.

A module reached by several entries is captured once. NFC, Unicode 15.1
case-fold, exact-entry, and physical-file hazards reject. The closure identity
commits to the canonical entry list and, for every canonical module path, its
byte count, content digest, and resolved local edges. Captured bytes are
copy-on-read, remain unchanged after visible source edits, and are zeroed when
the invocation-local owner is disposed.

This is the first candidate-wide declaration closure, but not yet the complete
project aggregate: Flow package membership and retained Package/1 objects are
still captured by their existing owners.

## 3. Closed build resolver

The host sends only the captured entry, module bytes, and resolved edge table
to the already sealed evaluator. Bun's build resolver can load:

```text
one selected captured entry
captured target named by an exact recorded edge
the evaluator-owned @jigging/jig bundle
```

It has no filesystem fallback. A build import absent from the captured edge
table fails even if a matching file exists in the sandbox or host project.
Bun 1.3 reports the importer namespace as `file` for imports parsed from a
custom-namespace load result, so the resolver validates the canonical importer
module identity rather than trusting that reported namespace. This behavior is
part of the sealed evaluator/build receipt, not a portable runtime assumption.

The host-side scanner discovers candidate edges; the evaluator's closed build
resolver remains authoritative. A scanner disagreement can make a candidate
unavailable or invalid, but cannot open a live path or grant an undeclared
resolver fallback.

## 4. Evidence

The ordinary corpus proves:

- deterministic identity independent of entry order;
- one shared capture across multiple entries;
- mutation isolation and disposal;
- cycle, case-fold collision, graph escape, dynamic import, CommonJS, bare
  import, missing suffix, and aggregate-limit rejection.

The privileged corpus evaluates project and Binding entries from one shared
captured closure after their visible entry and helper sources are modified. It
records the same sealed evaluator and cgroup/Bubblewrap receipts as review 111.
No Jig-owned cgroup remains after the suite.

## 5. Next boundary

Jig can now assemble the first private retained project aggregate:

```text
capture and evaluate jig.ts closure
    -> expand its exact Flow and Binding sources
    -> capture Flow packages and Binding entries under one candidate owner
    -> evaluate every Binding from the shared declaration closure
    -> publish one retained aggregate
    -> feed the existing pure package/Binding linker
```

That aggregate must own all retained artifacts and evaluation receipts, reject
partial publication, and never reopen visible source during linking. It remains
private until resolution, consent, locking, and admission justify a public
administration shape.

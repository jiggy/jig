# Private READY activation admission

**Status:** implemented private admission checkpoint. The former
unavailable-only candidate and store now admit one closed activation target as
either exact `READY` evidence or exact `UNAVAILABLE` evidence. This is not a
public administration API, Runtime Adapter SPI, Sandbox Backend SPI, or durable
root-Run controller.

## 1. One admission model

Jig now has one private activation candidate rather than parallel READY and
unavailable stores. Its single target carries exactly one disposition:

```text
READY(recipe digest, planning-observation digest)
UNAVAILABLE(reason code, bounded evidence digests)
```

The READY factory accepts only an invocation-authenticated direct Python recipe
whose request and observation identities equal the retained planner result.
Persisted candidate bytes contain stable identities, never live Backend,
runtime-receipt, process, or materialization objects. Strict decoding cannot
mint factory provenance.

The renamed SQLite owner advances one monotonic candidate head and one linear
admission head for both dispositions. Schema/application identity moved to
private version 3 rather than silently interpreting the old unavailable-only
database. Lock-first publication, reviewed-plan staleness checks, generation
compare-and-set, replay receipts, sidecar rejection, owner-only paths, and
protected Package/1 reacquisition are unchanged.

## 2. Restart execution proof

The Linux proof now performs the complete private transition:

```text
retained project
  -> authentic direct flow.py request
  -> exact Python recipe
  -> READY candidate
  -> reviewed lock-first admission
  -> fresh runtime-support observation and re-planning
  -> protected Package/1 reacquisition
  -> cgroup-v2 + Bubblewrap launch
  -> real Run/1 terminal
  -> fenced cleanup
```

The executable package vendors the real Python FLOW SDK and receives no
settings, attachments, capability slots, network, ambient environment, or
writable host path. After admission, a fresh observation must reproduce the
admitted recipe and planning-observation identities before package code may
start. Runtime bytes remain owned and retained by the sandbox host lease; Jig
only authenticates the read-only receipt.

## 3. Validation

The focused canonical and durable-store suite passes 15 tests with 118
expectations. The ordinary suite passes 306 tests with 66,559 expectations;
its 14 hostile cases are intentionally gated. The proof-host suite passes all
14 hostile tests with 139 expectations, including the retained-project READY
admission and actual contained execution. The final residue audit found no Jig
test cgroup or temporary control directory.

## 4. Deliberate boundary

This checkpoint does not yet accept a root submission or allocate a durable
Run identity. It cannot recover an unknown terminal after coordinator loss.
The next slice is therefore a private idempotent root-Run controller over one
already admitted generation. It must journal submission, spawn intent, and the
terminal result; unknown post-spawn state becomes `lost` or failure and is
never replayed or inferred as success.

# Private mixed coordinator-loss checkpoint

**Status:** closed on 2026-08-28 for one manual private recovery choreography.
This checkpoint publishes no supervisor, restart policy, Service controller,
Runtime Adapter, Sandbox Backend, or project API.

## 1. Exact claim

One dedicated worker owns an acknowledged Bun Service Mount and an admitted
Bun root which calls the Service beside an exact Python child and canonical
Journal append. The Service invocation deliberately remains pending after its
durable possible-dispatch record. The test kills that complete coordinator,
waits for the proven Linux Backend to remove every Run and Mount owner, then
opens a separately fenced coordinator against the same durable v17 store.

The successor performs the existing recovery operations explicitly. It proves
this causal order without sending the Service invocation again:

```text
provider fence
    -> possibly dispatched invocation becomes UNCERTAIN and closes
    -> generation lease becomes provider-lost and releases
    -> root becomes COORDINATOR_LOST and releases
    -> Mount finalizes only after the root release exists
```

The recovered root retains the exact Service closure and no fabricated child
or Journal result. The invocation retains its dispatch evidence and has no
second dispatch. This is a loss-accounting proof, not a claim that unknown
provider work can be rolled back or recovered as success.

## 2. Busy ownership is retryable only at the whole invocation boundary

The authentic witness exposed one store-ownership bug. A transient exact
`ADMISSION_STATE_BUSY` could escape from the durable executor and be converted
to a permanent root execution failure, even though retrying the complete
durable invocation is safe. The root-administration controller now retries
that one exact error at the outer executor boundary for both current and
older-coordinator recovery. The root controller preserves the same error while
still fencing and durably recording any terminal it can prove.

No other error is retried. A retry sees the retained sandbox/fence and cannot
launch package bytes twice. Focused tests cover one successful transient busy,
bounded exhaustion, non-busy refusal, and older-epoch recovery.

## 3. The observer is test rendezvous, not authority

The killed worker uses one read-only, no-follow SQLite connection to wait until
the exact invocation row contains a dispatch digest while both invocation and
root terminals remain absent. It closes that connection before announcing the
kill point. The successor subsequently authenticates every fact through the
ordinary store and recovery machinery.

The read-only query is therefore only a hostile-test rendezvous. It is not a
product API, proof authority, replacement store implementation, or permission
for callers to inspect `.jig` directly.

## 4. Evidence

The focused ordinary checks passed:

```text
TypeScript build                                      passed
current-executor busy retry                           passed
older-epoch busy retry                                passed
private foreground regression                         passed
```

After the Linux capability preflight, the focused hostile witness passed:

```text
runs and manually recovers one private mixed
composition across coordinator loss                  1 passed
expectations                                          45
residual Jig cgroups                                  0
residual private device directories                  0
host /dev/urandom                                     character 1:9, mode 0666
```

The preflight proved passwordless trusted-launcher access, writable cgroup v2,
the `cpu`, `memory`, and `pids` subtree controllers and controls, and separate
KVM/TUN availability. No hostile payload ran before that proof.

## 5. Deliberate limits

This checkpoint does not prove or introduce:

- an automatic supervisor, replacement loop, daemon, or public restart API;
- provider state recovery or exactly-once external effects;
- automatic rebinding to a replacement generation;
- every cancellation/deadline race in the mixed path;
- a portable Host-under-test corpus or a second independent Service Host; or
- a public Service-host, effect-routing, project, runtime, or sandbox surface.

The complete cross-language Host/Provider corpus and a second Host remain the
Service conformance gates. This one private proof is sufficient to stop
treating end-to-end mixed provider/coordinator-loss ordering as unknown.

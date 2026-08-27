# Private Python recipe planner

**Status:** implemented private planning checkpoint. It converts one authentic
zero-configuration `flow.py` activation request into a re-plannable exact
recipe and executes only protected Package/1 bytes. Review 134 now admits that
recipe as one private `READY` generation. Neither checkpoint is a public
Runtime Adapter or durable root-Run API.

## 1. Planning boundary

`planPrivatePythonDirectRun` accepts only:

- an invocation-authenticated activation request produced by the retained
  package linker;
- an authenticated host-leased runtime-support observation; and
- the authenticated private Linux Backend.

It accepts one direct Run target whose entrypoint is exactly `flow.py`, whose
optional selector matches the explicitly configured `python` token, and whose
settings, attachments, and slots are empty. It observes the Backend mechanism
without starting package code and derives one closed activation observation
covering:

- the exact request and Package/1 identity;
- planner implementation revision and bytes;
- runtime receipt, closure, executable, and bytes;
- Backend implementation and mechanism identity;
- fixed empty authority;
- fixed package, scratch, environment, and resource-ceiling semantics; and
- no preparation step or runtime predicate exception.

The returned recipe is immutable and process-authenticated. Re-planning the
same request against the same protected host facts yields the same observation
digest. A selector mismatch fails before activation.

## 2. Execution boundary

`runPrivatePythonDirectRecipe`:

1. validates input JSON and rejects settings or attachment drift before
   starting a process;
2. re-observes the Backend and re-hashes the selected executable;
3. reacquires the exact Package/1 object from Jig's protected artifact store;
4. materializes only those retained bytes;
5. mounts the package and receipt-derived runtime closure read-only;
6. launches through the existing cgroup-v2/Bubblewrap Backend;
7. drives the real Run/1 Host session; and
8. removes materialized bytes after the fenced process completion.

The fixture no longer launches a mutable test directory directly. It captures,
publishes, reacquires, and materializes the package through the same durable
artifact seam required by a later admitted root Run.

## 3. Deliberate limits

This first planner does not inspect `pyproject.toml`, prepare dependencies,
install the SDK, or claim general Python compatibility. The successful fixture
vendors the real Python FLOW SDK in its Package/1 tree. Missing undeclared
imports remain ordinary component execution failures.

The recipe contains live invocation-local Backend and runtime observations, so
it is intentionally not serializable. Admission may persist only its stable
observation identity. After restart, the host must re-plan from the authentic
activation request and compare the new observation with the admitted one.

The next checkpoint described here is complete in
[review 134](134-private-ready-activation-admission.md): one activation
candidate/store now represents both exact `READY` and exact `UNAVAILABLE`
without weakening lock-first review, generation CAS, or unavailable semantics.

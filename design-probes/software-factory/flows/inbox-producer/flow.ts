#!/usr/bin/env deno
// DESIGN PROBE ONLY.
// The exact producer implementation is intentionally absent. A real version
// must speak FLOW Run/1, read only the admitted `inbox` projection, and invoke
// the exact `journal.append` effect with a stable operation ID.

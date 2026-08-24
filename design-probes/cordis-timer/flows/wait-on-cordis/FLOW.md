---
name: wait-on-cordis
description: Wait once through the configured delay capability.
uses:
  delay:
    contract: ./contracts/delay.capability.json
---

# Wait on Cordis

Invoke `delay.wait` once with the requested duration and return its result. The
Flow knows only its local `delay` slot and the portable capability descriptor;
it has no Cordis-specific code.

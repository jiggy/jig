---
name: cordis-delay
description: Wait through an unmodified Cordis Timer component.
service: 1
provides:
  delay: ./contracts/delay.capability.json
---

# Cordis delay adapter

Create one Cordis realm, install the published Timer Service unchanged, and
expose one bounded JSON `wait` method. Native callbacks, Context, Fibers,
Services, and disposers remain inside the realm.

Each call remains pending until its timer fires or the invocation is cancelled.
Cancellation of the FLOW Mount disposes the root Cordis Fiber and therefore all
remaining Cordis timer effects.

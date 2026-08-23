---
name: schedule-reminder
description: Schedule one process-local reminder through the configured scheduler.
uses:
  scheduler:
    contract: ./contracts/scheduler.capability.json
---

# Schedule reminder

Submit one single-use timer ID and return the scheduler's accepted record. The
timer belongs to the scheduler Mount after this Run completes; this Flow does
not retain a callback, disposer, or portable timer handle.


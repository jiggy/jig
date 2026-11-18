---
"@jigging/jig": minor
---

Add an explicit recovery-only `client.reconcile({ ticket })` and `jig attempt reconcile --json` for accepted attempts whose foreground coordinator was lost. Reacquire the trusted project owner to fence and settle older durable work without preparing, submitting, or replaying the original Flow. Refuse active ownership or cleanup that cannot be confirmed; preserve the original ticket and retained checkpoints.

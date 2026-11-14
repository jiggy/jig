---
'@jigging/agent-acp': patch
'@jigging/jig': patch
---

Upgrade the ACP agent transport and Jig finite ACP host to ACP v2 only, removing v1 protocol compatibility. Support insertion acknowledgement, agent-owned message identifiers, content upsert handling, terminal foreground state, required session close, and updated Codex, Claude, and Pi ACP adapters.
Deliver native candidate recovery across optional `backup1`–`backup3` slots with `uses.<slot>.optional`, host-attested `not-forwarded` and `rejected-without-output` failure boundaries, confirmed pre-dispatch failure metadata, and confirmed cleanup. Preserve Codex session continuity across compatible same-client authentication profiles with atomic pre-acceptance release.

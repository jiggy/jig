---
"@jigging/jig": minor
"@jigging/agent-acp": patch
"@jigging/agent-method": patch
"@jigging/display-model": patch
"@jigging/display-tui": patch
"@jigging/display-web": patch
"@jigging/reporting": patch
---

Replace the Codex ACP v1 compatibility adapter with upstream native ACP v2.
Preserve private subscription bootstrap, finite inference, cancellation,
native failure diagnostics, and truthful shutdown results. Remove Jig's direct
ACP v1 SDK dependency. Rebuild the canonical archives affected by the patch.

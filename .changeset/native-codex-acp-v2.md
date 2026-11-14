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
Retain only the one-time private subscription bootstrap and suppression of
unreviewed title-generation inference. Remove Jig's direct ACP v1 SDK
dependency. Rebuild the canonical workspace archives affected by the patched
dependency input.

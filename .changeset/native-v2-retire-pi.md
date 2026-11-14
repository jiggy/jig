---
"@jigging/jig": minor
"@jigging/agent-acp": patch
"@jigging/agent-method": patch
"@jigging/display-model": patch
"@jigging/display-tui": patch
"@jigging/display-web": patch
"@jigging/reporting": patch
---

Remove the legacy Pi ACP v1 compatibility bridge rather than preserving protocol
translation in Jig's native Agent support. Only qualified direct ACP v2
implementations are eligible as Codex or Claude Code clients. Pi requires a
native ACP v2 adapter and independent conformance before admission can return.

---
"@jigging/jig": minor
---

Support native Apple Silicon macOS 15+ through required process identity,
coalition accounting and sandbox capabilities instead of exact OS build pins.
Record each host's observed identity and fail closed when enforcement is unavailable.
Retire Intel macOS support while requiring genuine native ARM Codex session
creation, containment and cleanup on macOS 15 and 26. Preserve fresh bounded
preference-policy observation and refuse unavailable or configured forced policy.

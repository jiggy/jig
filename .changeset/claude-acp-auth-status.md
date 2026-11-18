---
'@jigging/jig': patch
---

Keep Claude Code authentication-status notifications inside the bundled ACP
adapter. Previously, unsolicited identity notices could stop the finite ACP
exchange before Jig forwarded the first task prompt. The workspace build
inputs and canonical qualification archives now use the corrected patch.

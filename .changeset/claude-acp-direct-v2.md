---
"@jigging/jig": patch
---

Upgrade the bundled Claude Agent ACP bridge to the direct ACP v2 implementation
and align its Claude SDK with the supported upstream release. Preserve Jig's
finite task authority by reapplying the title-generation suppression to the
new adapter distribution. This addresses Claude's pre-prompt failure during
native publication qualification without bypassing host or live API gates.

---
'@jigging/agent-method': patch
'@jigging/display-model': patch
'@jigging/display-tui': patch
'@jigging/display-web': patch
'@jigging/reporting': patch
---

Requalify shared workspace build inputs after the root dependency patch policy
now pins Claude Agent ACP 0.101.0 with Jig's nonessential-title-inference
safeguard. No unrelated application behavior was intentionally changed. The
root patched-dependency policy participates in each package's reviewed build.

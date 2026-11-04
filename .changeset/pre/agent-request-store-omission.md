---
"@jigging/agent-method": minor
---

Add the `omitStore` Binding setting to omit the `store` request field for endpoints that reject it.
Omitted or false settings retain `store: false` for both supported APIs.
Model selection, token bounds, strict structured output, local validation, and HTTP grant enforcement remain unchanged.

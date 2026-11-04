---
"@jigging/agent-method": minor
"@jigging/agent-acp": minor
"@jigging/jig": patch
---

Preserve refusal and limit outcomes with their original text when structured
output cannot be decoded or does not match the requested response schema.
Include structured data only when it validates, without promoting a partial
answer to completion. Completed answers and independently supplied structured
results remain strict.

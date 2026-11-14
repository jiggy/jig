---
'@jigging/jig': patch
---

Permit ACP grants to select a separately reviewed named operator authentication profile without embedding credentials in project source.
Keep workload model choice separate from the authentication profile, reject missing or ambiguous client-specific credentials, and isolate selected profile bytes from ambient and sibling accounts.
Bind the named profile to native provider identity and refuse a cross-client review override that would reinterpret its authentication scope.

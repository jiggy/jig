---
"@jigging/jig": patch
---

Allow operators to route reviewed HTTPS requests through an explicit CONNECT proxy with `JIG_HTTP_REQUEST_HTTPS_PROXY`.
Keep the exact HTTP grant, TLS verification, private credentials, and contained-worker cleanup.

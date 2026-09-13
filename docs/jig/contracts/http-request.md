---
title: HTTP Request contract
description: Make an exact operator-authorized HTTP request without receiving a credential or network access.
---

# HTTP Request contract

HTTP Request lets an ordinary Flow retrieve data or implement a service client
without holding that service's credential. Jig performs one exact authorized
request; the Flow interprets its response.

`https://jig.md/contracts/http-request` names the interface, not a server or a
permission. A Flow includes its [JSON descriptor](https://jig.md/contracts/http-request/contract.json)
locally and refers to it from `uses`. Jig matches its exact identity offline.
The operator separately supplies named endpoint grants and approves their use.

- [Delegate an HTTP resource](../guide/http.md): declaration, Binding and first call.
- [Exact HTTP Request specification](../spec/http-request.md): policy, failures,
  credential trust, cancellation and limits.

This page explains the identity. It is not fetched during invocation resolution.

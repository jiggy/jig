---
name: contact-import-map-code
description: Recognize the known Customer, Email address, Company export without an Agent.
outcomes:
  blocked: The selected method cannot complete its work.
  limit: The Agent reaches its limit.
---

Recognize exactly the three headings `Customer`, `Email address`, and `Company`,
in any order. Return their zero-based indices as `mapping.name`, `mapping.email`,
and `mapping.organization`. Otherwise return `mapping: null`. No Agent is called.
The caller can replace this method while retaining the same input/result contract.

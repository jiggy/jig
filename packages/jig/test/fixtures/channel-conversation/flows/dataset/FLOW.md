---
name: sample-reader
description: Answer bounded requests for Celsius readings from this invocation's explicit dataset.
channels:
  requests:
    direction: receive
    delivery: direct
    contract: ./contracts/sample-request.json
  replies:
    direction: send
    delivery: direct
    contract: ./contracts/sample-celsius.json
outcomes:
  blocked: A request was invalid, repeated, unknown, over budget, or the exchange was interrupted.
---

Internal host-test participant for named request/reply correlation, EOF,
peer failure, and cancellation. This is a synthetic protocol fixture, not
a recommended application. Its test owns expectations and faulty peers.

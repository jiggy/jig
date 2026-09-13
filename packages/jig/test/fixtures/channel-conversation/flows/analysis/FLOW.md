---
name: threshold-search
description: Find the first Celsius threshold crossing by requesting only the readings needed for a bounded adaptive search.
channels:
  requests:
    direction: send
    delivery: direct
    contract: ./contracts/sample-request.json
  replies:
    direction: receive
    delivery: direct
    contract: ./contracts/sample-celsius.json
outcomes:
  blocked: Replies were missing, invalid, inconsistent with the conversation, or interrupted.
---

Internal host-test participant for named request/reply correlation, EOF,
peer failure, and cancellation. This is a synthetic protocol fixture, not
a recommended application. Its test owns expectations and faulty peers.

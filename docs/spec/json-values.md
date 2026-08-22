# FLOW JSON/1 value model

FLOW uses JSON as a bounded cross-language value format. JSON/1 fixes the
parts which ordinary host parsers otherwise disagree about; it is not a new
serialization syntax.

It applies to protocol frames, settings, inputs, results, Service values,
Event data, schemas, and descriptors unless a narrower profile states a lower
limit.

## Syntax and strings

JSON/1 is [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) JSON encoded as
UTF-8, with no BOM. Parsers reject duplicate
object member names before constructing an object. Strings and member names
contain Unicode scalar values only; literal or escaped lone surrogates are
invalid. Host-language object prototypes and magic property names have no
semantic role.

## Numbers

A number is a finite IEEE 754 binary64 value obtained by correctly rounded
decimal conversion using round-to-nearest, ties-to-even. NaN and infinities are
not values. A number whose resulting value is mathematically integral must be
within `[-9007199254740991, 9007199254740991]`; larger integral quantities use
strings. Negative zero is admitted but equals and canonicalizes as zero.

Consequently `1` and `1.0` are the same JSON/1 value, while the integer token
`9007199254740993` is invalid instead of being preserved by Python and rounded
by JavaScript.

## Equality and canonical bytes

Equality is recursive:

- null, booleans, and strings compare by exact value;
- numbers compare by their binary64 numeric value, with `-0` equal to `0`;
- arrays compare by length and corresponding values in order;
- objects compare by the same exact member-name set and equal corresponding
  values, independent of source member order.

[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) serializes an already valid
JSON/1 value for digests and operation
identities. Canonicalization does not repair duplicate keys, invalid Unicode,
an out-of-domain number, or an oversized value; those fail first.

## Absolute value limits

One encoded JSON/1 document or protocol frame has these inclusive maxima:

```text
UTF-8 encoded bytes                   16,777,216
value depth (root is 1)                       128
total value nodes, including root         262,144
members in one object                      65,536
items in one array                         65,536
UTF-8 bytes in one string value         8,388,608
UTF-8 bytes in one member name              1,024
bytes in one number token                      128
```

Every array item and object member value is one child value node; member names
are not additional nodes. A profile may impose a smaller bound only when that
bound is declared before the value is produced or accepted—for example in the
immutable Run limits supplied at invocation. It may never accept a value above
the JSON/1 absolute maxima while claiming JSON/1 conformance.

Malformed or out-of-domain data is `INVALID_JSON` at a protocol boundary. A
narrower value seam reports its own validation error, such as
`SCHEMA_INVALID_JSON`, `INVALID_INPUT`, or `INVALID_RESULT`.

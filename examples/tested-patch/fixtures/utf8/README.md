# UTF-8 prefix utility — synthetic repository

`truncateUtf8(text, maxBytes)` should retain the longest prefix that fits the
UTF-8 byte budget, without splitting a Unicode code point. It does not promise
to preserve grapheme clusters. Budgets must be nonnegative safe integers.

The implementation incorrectly counts UTF-16 positions rather than UTF-8
bytes. Only `src/truncate-utf8.ts` may change. Preserve its public export and
invalid-budget behavior. No dependencies or generated files are needed.
